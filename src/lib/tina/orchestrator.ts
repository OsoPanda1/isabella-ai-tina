/**
 * TINA orchestrator (src/lib/tina/orchestrator.ts)
 * Routes requests, runs ethical triage, appends BookPI chain events.
 * Does not execute real tools or call external models without an authorized backend.
 */
import { auditTinaContent, type TinaEthicalResult } from "./ethical";
import { TinaBookPI, type TinaBookEvent } from "./ledger";
import { TinaPluginRegistry } from "./plugins";
import { routeTina } from "./router";
import { normalizeComplexity, type TinaComplexityScore, type TinaRoute } from "./types";
import { buildTinaCacheKeySync, type TinaCacheInput } from "./cache";
import { ISABELLA_TINA_MEMBER, TINA_CATEGORY_ID } from "./category";

export interface TinaToolCapability {
  token: string;
  toolId: string;
  expiresAt: number;
  scopes: string[];
}

export interface TinaToolAdapter {
  toolId: string;
  execute: (input: { text: string; tenantId: string; principalId: string }) => Promise<unknown>;
}

export interface TinaExecuteInput {
  text: string;
  complexity: Partial<TinaComplexityScore>;
  tenantId: string;
  principalId: string;
  territoryId?: string;
  scopes?: string[];
  policyVersion?: string;
  knowledgeVersion?: string;
  modelVersion?: string;
  adapter?: TinaToolAdapter;
  capability?: TinaToolCapability;
}

export type TinaExecuteStatus =
  "pending_human_review" | "blocked_or_review" | "accepted_for_adapter";

/**
 * Estado inequívoco de ejecución (ISA-026). El orquestador no ejecuta
 * herramientas ni llama modelos externos: `executed` es siempre `false` y el
 * motivo documenta por qué no hubo ejecución real.
 */
export type TinaNonExecutionReason =
  "ADAPTER_NOT_BOUND" | "HUMAN_REVIEW_REQUIRED" | "ETHICAL_BLOCK";

export interface TinaExecutionOutcome {
  executed: false;
  reason: TinaNonExecutionReason;
  detail: string;
}

export interface TinaExecuteResult {
  status: TinaExecuteStatus;
  route: TinaRoute;
  category: typeof TINA_CATEGORY_ID;
  member: typeof ISABELLA_TINA_MEMBER.systemId;
  contentHash?: string;
  audit?: TinaEthicalResult;
  cacheKey?: string;
  ledger?: TinaBookEvent;
  execution: TinaExecutionOutcome;
}

const NOT_EXECUTED_ADAPTER: TinaExecutionOutcome = {
  executed: false,
  reason: "ADAPTER_NOT_BOUND",
  detail:
    "Ningún adapter de ejecución está ligado: la solicitud fue enrutada y auditada, no ejecutada.",
};

export class TinaOrchestrator {
  private readonly bookpi: TinaBookPI;
  private readonly plugins: TinaPluginRegistry;

  constructor(bookpi?: TinaBookPI) {
    this.bookpi = bookpi ?? new TinaBookPI();
    this.plugins = new TinaPluginRegistry(this.bookpi);
  }

  async execute(input: TinaExecuteInput): Promise<TinaExecuteResult> {
    if (
      input.adapter &&
      (!input.capability ||
        input.capability.toolId !== input.adapter.toolId ||
        input.capability.expiresAt <= Date.now() ||
        !input.capability.scopes.includes("tool:execute"))
    ) {
      return {
        status: "blocked_or_review",
        route: routeTina(normalizeComplexity(input.complexity)),
        category: TINA_CATEGORY_ID,
        member: ISABELLA_TINA_MEMBER.systemId,
        execution: {
          executed: false,
          reason: "ETHICAL_BLOCK",
          detail: "Capability token ausente, expirado o sin scope tool:execute.",
        },
      };
    }
    const complexity = normalizeComplexity(input.complexity);
    const route = routeTina(complexity);

    const ledger = await this.bookpi.append("TINA_ROUTE_SELECTED", {
      path: route.path,
      mode: route.mode,
      tenantId: input.tenantId,
      principalId: input.principalId,
      category: TINA_CATEGORY_ID,
    });

    const base = {
      route,
      category: TINA_CATEGORY_ID,
      member: ISABELLA_TINA_MEMBER.systemId,
      ledger,
    } as const;

    if (route.requiresHumanReview) {
      return {
        ...base,
        status: "pending_human_review",
        execution: {
          executed: false,
          reason: "HUMAN_REVIEW_REQUIRED",
          detail: "Ruta de revisión humana: nada se ejecuta hasta aprobación explícita.",
        },
      };
    }

    const audit = await auditTinaContent(input.text, {
      history: [],
      useAegis: true,
    });

    if (!audit.valid && route.path !== "FAST") {
      await this.bookpi.append("TINA_BLOCKED", {
        reason: "ethical_triage_failed",
        score: audit.score,
        flags: audit.flags.map((f) => f.code),
        tenantId: input.tenantId,
      });
      return {
        ...base,
        status: "blocked_or_review",
        audit,
        execution: {
          executed: false,
          reason: "ETHICAL_BLOCK",
          detail: "Triaje ético fallido: la solicitud no se ejecuta.",
        },
      };
    }

    const cacheInput: TinaCacheInput = {
      tenantId: input.tenantId,
      principalId: input.principalId,
      scopes: input.scopes ?? [],
      prompt: input.text,
      policyVersion: input.policyVersion ?? "v0",
      knowledgeVersion: input.knowledgeVersion ?? "v0",
      modelVersion: input.modelVersion ?? "v0",
      territoryId: input.territoryId ?? "unbound",
      path: route.path,
    };
    const cacheKey = buildTinaCacheKeySync(cacheInput);

    await this.bookpi.append("TINA_ACCEPTED", {
      path: route.path,
      mode: route.mode,
      contentHash: audit.hash,
      cacheKey,
      tenantId: input.tenantId,
      execution: NOT_EXECUTED_ADAPTER,
    });

    return {
      ...base,
      status: "accepted_for_adapter",
      contentHash: audit.hash,
      audit,
      cacheKey,
      execution: NOT_EXECUTED_ADAPTER,
    };
  }

  getBookPI(): TinaBookPI {
    return this.bookpi;
  }

  getPlugins(): TinaPluginRegistry {
    return this.plugins;
  }
}

export function createTinaOrchestrator(bookpi?: TinaBookPI): TinaOrchestrator {
  return new TinaOrchestrator(bookpi);
}
