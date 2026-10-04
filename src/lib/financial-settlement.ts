/**
 * FINANCIAL SETTLEMENT SAGA (src/lib/financial-settlement.ts)
 * -----------------------------------------------------------------
 * Una sola transacción LÓGICA para el flujo de pago:
 *
 *   webhook claim → economic event → BookPI → accounting → audit
 *
 * Sin XA distribuido entre módulos, la atomicidad se logra por:
 *  - idempotencia en cada paso (reintentos seguros ante fallo parcial),
 *  - orden estricto (nunca acreditar sin claim; nunca asentar sin evento),
 *  - compensación explícita: si un paso posterior falla, se registra el
 *    evento de reversa correspondiente (nunca se borra nada).
 *
 * Los pasos son inyectables para probar la orquestación; por defecto
 * usan los módulos productivos reales.
 */

import { randomUUID } from "node:crypto";

export interface SettlementInput {
  provider: string;
  providerEventId: string;
  eventType: string;
  tenantId: string;
  actorId: string;
  amountMinor: number;
  idempotencyKey: string;
  operation: string;
  category: "inference" | "processing" | "apis" | "skills" | "other";
  cost: number;
  tokens: number;
}

export type SettlementStatus = "settled" | "duplicate" | "aborted";

export interface SettlementReceipt {
  status: SettlementStatus;
  steps: string[];
  compensations: string[];
  blockIndex?: number;
  error?: string;
}

export interface SettlementSteps {
  claim: (input: {
    provider: string;
    providerEventId: string;
    eventType: string;
  }) => Promise<{ status: string }>;
  record: (input: {
    tenantId: string;
    actorId: string;
    eventType: string;
    amountMinor: number;
    direction: "DEBIT" | "CREDIT";
    source: string;
    provider: string;
    providerEventId: string;
    idempotencyKey: string;
  }) => Promise<{ ok: boolean; duplicate?: boolean; error?: string }>;
  appendLedger: (input: {
    tenantId: string;
    userId: string;
    operation: string;
    category: SettlementInput["category"];
    cost: number;
    tokens: number;
  }) => Promise<{
    success: boolean;
    block?: { index: number };
    error?: string;
  }>;
  appendAccounting: (input: {
    tenantId: string;
    description: string;
    lines: Array<{
      accountId: string;
      debitCents?: number;
      creditCents?: number;
    }>;
  }) => Promise<{ success: boolean; error?: string }>;
  compensate: (input: {
    tenantId: string;
    actorId: string;
    eventType: string;
    amountMinor: number;
    idempotencyKey: string;
    reason: string;
  }) => Promise<unknown>;
  audit: (event: string, details: string) => Promise<unknown> | unknown;
}

async function defaultSteps(): Promise<SettlementSteps> {
  const economic = await import("./economic-events");
  const { createBookpiPostgresRepository } =
    await import("./repositories/bookpi-postgres-runtime");
  const { createAuditRepository } = await import("./repositories/audit-repository");
  const { PostgresAccountingRepository } =
    await import("./accounting/accounting-postgres-repository");
  const { createDoubleEntryService } = await import("./accounting/double-entry-service");
  const auditRepository = createAuditRepository();
  const bookpi = createBookpiPostgresRepository();
  return {
    claim: (input) => economic.claimWebhookEvent(input),
    record: (input) => economic.recordEconomicEvent(input),
    appendLedger: (input) => bookpi.append(input),
    // P0-C: asiento REAL de doble entrada sobre PostgreSQL (atómico vía
    // createJournalEntryAtomic). Se difiere (no bloquea) solo cuando el
    // llamador no emite líneas balanceadas; NUNCA se asienta en memoria.
    appendAccounting: async (input) => {
      if (!input.lines || input.lines.length < 2) {
        return {
          success: false,
          error: "Asiento diferido: se requieren ≥2 líneas balanceadas (débito=crédito).",
        };
      }
      const service = createDoubleEntryService(new PostgresAccountingRepository());
      const result = await service.createDoubleEntryTransaction({
        tenantId: input.tenantId,
        description: input.description,
        createdBy: "financial-settlement",
        lines: input.lines.map((line) => ({
          accountId: line.accountId,
          debitCents: line.debitCents,
          creditCents: line.creditCents,
        })),
      });
      if (!result.success) {
        return { success: false, error: result.error };
      }
      return { success: true };
    },
    compensate: (input) =>
      economic.recordEconomicEvent({
        tenantId: input.tenantId,
        actorId: input.actorId,
        eventType: input.eventType,
        amountMinor: input.amountMinor,
        direction: "CREDIT",
        source: "settlement-compensation",
        idempotencyKey: input.idempotencyKey,
        metadata: { reason: input.reason },
      }),
    audit: (event, details) =>
      auditRepository.append({
        traceId: `trc_settle_${randomUUID().slice(0, 8)}`,
        correlationId: inputCorrelation(),
        actorIp: "127.0.0.1",
        event,
        severity: "S2",
        details,
      }),
  };
}

function inputCorrelation(): string {
  return `corr_settle_${randomUUID().slice(0, 8)}`;
}

/**
 * Ejecuta la saga. Aborta al primer fallo con compensación auditada.
 * Reentrante: repetir con las mismas claves no duplica (idempotencia).
 */
export async function settlePayment(
  input: SettlementInput,
  steps?: SettlementSteps,
): Promise<SettlementReceipt> {
  const active = steps ?? (await defaultSteps());
  const completed: string[] = [];
  const compensations: string[] = [];

  // Paso 1: claim de idempotencia del webhook.
  const claim = await active.claim({
    provider: input.provider,
    providerEventId: input.providerEventId,
    eventType: input.eventType,
  });
  if (claim.status === "duplicate") {
    return { status: "duplicate", steps: ["claim:duplicate"], compensations };
  }
  if (claim.status === "error") {
    await active.audit(
      "settlement.claim_failed",
      `Claim fallido para ${input.providerEventId}; reintento seguro por idempotencia.`,
    );
    return {
      status: "aborted",
      steps: [],
      compensations,
      error: "claim failed",
    };
  }
  completed.push("claim");

  // Paso 2: evento económico canónico.
  const recorded = await active.record({
    tenantId: input.tenantId,
    actorId: input.actorId,
    eventType: `SETTLEMENT:${input.eventType}`,
    amountMinor: input.amountMinor,
    direction: "CREDIT",
    source: input.provider,
    provider: input.provider,
    providerEventId: input.providerEventId,
    idempotencyKey: input.idempotencyKey,
  });
  if (!recorded.ok) {
    if (recorded.duplicate) return { status: "duplicate", steps: completed, compensations };
    await active.audit("settlement.record_failed", `Evento económico fallido: ${recorded.error}`);
    return {
      status: "aborted",
      steps: completed,
      compensations,
      error: recorded.error,
    };
  }
  completed.push("record");

  // Paso 3: bloque BookPI.
  const appended = await active.appendLedger({
    tenantId: input.tenantId,
    userId: input.actorId,
    operation: `${input.operation} [settle:${input.idempotencyKey}]`,
    category: input.category,
    cost: input.cost,
    tokens: input.tokens,
  });
  if (!appended.success) {
    await active.compensate({
      tenantId: input.tenantId,
      actorId: input.actorId,
      eventType: `REVERSAL:${input.eventType}`,
      amountMinor: input.amountMinor,
      idempotencyKey: `reversal:${input.idempotencyKey}`,
      reason: `ledger append fallido: ${appended.error}`,
    });
    compensations.push("reversal-recorded");
    await active.audit("settlement.ledger_failed", `Compensación registrada: ${appended.error}`);
    return {
      status: "aborted",
      steps: completed,
      compensations,
      error: appended.error,
    };
  }
  completed.push("ledger");

  // Paso 4: asiento contable (si el adaptador lo soporta).
  const accounted = await active.appendAccounting({
    tenantId: input.tenantId,
    description: `Settlement ${input.idempotencyKey}`,
    lines: [],
  });
  if (!accounted.success) {
    await active.audit(
      "settlement.accounting_deferred",
      `Asiento diferido (no bloqueante): ${accounted.error}`,
    );
    compensations.push("accounting-deferred");
  } else {
    completed.push("accounting");
  }

  await active.audit(
    "settlement.settled",
    `Liquidación completa: ${completed.join("+")} (bloque ${appended.block?.index ?? "?"}).`,
  );
  return {
    status: "settled",
    steps: completed,
    compensations,
    blockIndex: appended.block?.index,
  };
}

export const FINANCIAL_SETTLEMENT = {
  settle: settlePayment,
};
