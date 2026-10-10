import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryAccountingRepository } from "../../src/lib/accounting/accounting-repository";
import { createDoubleEntryService } from "../../src/lib/accounting/double-entry-service";
import type { Account } from "../../src/lib/accounting/types";

describe("Double-Entry Accounting System", () => {
  let repository: InMemoryAccountingRepository;
  let service: ReturnType<typeof createDoubleEntryService>;
  let tenantId: string;
  let cashAccount: Account;
  let revenueAccount: Account;
  let expenseAccount: Account;

  beforeEach(async () => {
    repository = new InMemoryAccountingRepository();
    service = createDoubleEntryService(repository);
    tenantId = "tenant-test-001";

    cashAccount = await repository.createAccount({
      tenantId,
      code: "1000",
      name: "Caja",
      type: "asset",
      currency: "USD",
    });

    revenueAccount = await repository.createAccount({
      tenantId,
      code: "4000",
      name: "Ingresos por Servicios",
      type: "revenue",
      currency: "USD",
    });

    expenseAccount = await repository.createAccount({
      tenantId,
      code: "5000",
      name: "Gastos Operativos",
      type: "expense",
      currency: "USD",
    });
  });

  describe("Validación de Doble Entrada", () => {
    it("debe rechazar transacción sin líneas", () => {
      const validation = service.validateDoubleEntry({
        tenantId,
        description: "Test",
        createdBy: "user",
        lines: [],
      });

      expect(validation.isValid).toBe(false);
      expect(validation.errors.length).toBeGreaterThan(0);
    });

    it("debe rechazar transacción con una sola línea", () => {
      const validation = service.validateDoubleEntry({
        tenantId,
        description: "Test",
        createdBy: "user",
        lines: [{ accountId: cashAccount.id, debitCents: 10000 }],
      });

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain(
        "La contabilidad de doble entrada requiere al menos dos líneas.",
      );
    });

    it("debe rechazar transacción desbalanceada", () => {
      const validation = service.validateDoubleEntry({
        tenantId,
        description: "Test desbalanceado",
        createdBy: "user",
        lines: [
          { accountId: cashAccount.id, debitCents: 10000 },
          { accountId: revenueAccount.id, creditCents: 5000 },
        ],
      });

      expect(validation.isValid).toBe(false);
      expect(validation.errors.some((e) => e.includes("no son iguales"))).toBe(true);
      expect(validation.differenceCents).toBe(5000);
    });

    it("debe aceptar transacción balanceada", () => {
      const validation = service.validateDoubleEntry({
        tenantId,
        description: "Test balanceado",
        createdBy: "user",
        lines: [
          { accountId: cashAccount.id, debitCents: 10000 },
          { accountId: revenueAccount.id, creditCents: 10000 },
        ],
      });

      expect(validation.isValid).toBe(true);
      expect(validation.errors.length).toBe(0);
      expect(validation.differenceCents).toBe(0);
    });

    it("debe rechazar línea con débito y crédito simultáneos", () => {
      const validation = service.validateDoubleEntry({
        tenantId,
        description: "Test inválido",
        createdBy: "user",
        lines: [
          { accountId: cashAccount.id, debitCents: 5000, creditCents: 5000 },
          { accountId: revenueAccount.id, creditCents: 10000 },
        ],
      });

      expect(validation.isValid).toBe(false);
      expect(validation.errors.some((e) => e.includes("tanto débito como crédito"))).toBe(true);
    });

    it("debe rechazar montos negativos", () => {
      const validation = service.validateDoubleEntry({
        tenantId,
        description: "Test negativos",
        createdBy: "user",
        lines: [
          { accountId: cashAccount.id, debitCents: -1000 },
          { accountId: revenueAccount.id, creditCents: 10000 },
        ],
      });

      expect(validation.isValid).toBe(false);
      expect(validation.errors.some((e) => e.includes("negativos"))).toBe(true);
    });
  });

  describe("Creación de Transacciones", () => {
    it("debe crear transacción de ingreso válida", async () => {
      const result = await service.createDoubleEntryTransaction({
        tenantId,
        description: "Venta de servicios",
        createdBy: "user-001",
        lines: [
          {
            accountId: cashAccount.id,
            debitCents: 10000,
            description: "Cobro",
          },
          {
            accountId: revenueAccount.id,
            creditCents: 10000,
            description: "Ingreso",
          },
        ],
      });

      expect(result.success).toBe(true);
      expect(result.entry).toBeDefined();
      expect(result.lines).toBeDefined();
      expect(result.lines!.length).toBe(2);
      expect(result.entry!.status).toBe("pending");
    });

    it("debe fallar con transacción desbalanceada", async () => {
      const result = await service.createDoubleEntryTransaction({
        tenantId,
        description: "Test fallido",
        createdBy: "user-001",
        lines: [
          { accountId: cashAccount.id, debitCents: 10000 },
          { accountId: revenueAccount.id, creditCents: 8000 },
        ],
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.entry).toBeUndefined();
    });
  });

  describe("Publicación de Entradas", () => {
    it("debe publicar entrada pendiente exitosamente", async () => {
      const createResult = await service.createDoubleEntryTransaction({
        tenantId,
        description: "Entrada a publicar",
        createdBy: "user-001",
        lines: [
          { accountId: cashAccount.id, debitCents: 15000 },
          { accountId: revenueAccount.id, creditCents: 15000 },
        ],
      });

      expect(createResult.success).toBe(true);
      const entryId = createResult.entry!.id;

      const postResult = await service.postJournalEntry(entryId);
      expect(postResult.success).toBe(true);

      const updatedEntry = await repository.getJournalEntryById(entryId);
      expect(updatedEntry!.status).toBe("posted");
      expect(updatedEntry!.postedAt).toBeDefined();
    });
  });

  describe("Reversión de Entradas", () => {
    it("debe reversar entrada publicada correctamente", async () => {
      const createResult = await service.createDoubleEntryTransaction({
        tenantId,
        description: "Entrada a reversar",
        createdBy: "user-001",
        lines: [
          { accountId: cashAccount.id, debitCents: 20000 },
          { accountId: revenueAccount.id, creditCents: 20000 },
        ],
      });

      await service.postJournalEntry(createResult.entry!.id);

      const reverseResult = await service.reverseJournalEntry(
        createResult.entry!.id,
        "Error en registro",
      );

      expect(reverseResult.success).toBe(true);

      const originalEntry = await repository.getJournalEntryById(createResult.entry!.id);
      expect(originalEntry!.status).toBe("reversed");
    });
  });

  describe("Balanza de Comprobación y Balance General", () => {
    it("debe generar balanza balanceada después de transacciones", async () => {
      const periodStart = new Date(2026, 0, 1);
      const periodEnd = new Date(2026, 11, 31);

      await service.createDoubleEntryTransaction({
        tenantId,
        description: "Transacción 1",
        createdBy: "user-001",
        lines: [
          { accountId: cashAccount.id, debitCents: 50000 },
          { accountId: revenueAccount.id, creditCents: 50000 },
        ],
      });
      // Needs posting for balance to pick it up (in standard accounting, balances are from posted entries)
      const t1 = await repository.getJournalEntriesByTenant(tenantId);
      await service.postJournalEntry(t1[0].id);

      await service.createDoubleEntryTransaction({
        tenantId,
        description: "Transacción 2",
        createdBy: "user-001",
        lines: [
          { accountId: expenseAccount.id, debitCents: 20000 },
          { accountId: cashAccount.id, creditCents: 20000 },
        ],
      });
      const t2 = await repository.getJournalEntriesByTenant(tenantId);
      await service.postJournalEntry(t2[1].id);

      const trialBalance = await service.getTrialBalance(tenantId, periodStart, periodEnd);

      expect(trialBalance.isBalanced).toBe(true);
      expect(trialBalance.totalDebitsCents).toBe(70000);
      expect(trialBalance.totalCreditsCents).toBe(70000);
    });
  });
});
