/**
 * Science Integrity — Contratos canónicos (src/lib/science-integrity/contracts.ts)
 * -------------------------------------------------------------------------------
 * Puente Fase B: Verificación y Certificación de Integridad Científica sobre los
 * módulos nativos de Isabella. Especificación de la directiva Fase A → Fase B.
 *
 * Honestidad (AGENTS.md §0.1): estos contratos son estado TESTED, no CERTIFIED.
 * Un agregado >= 0.90 habilita un sello de Nivel 2 PROVISIONAL según el manual
 * (§4.2); Nivel 4 exige auditoría externa independiente.
 */
import { z } from "zod";

export const ArticleDomainSchema = z.enum([
  "academic",
  "medical",
  "legal",
  "financial",
  "territorial",
  "technical",
  "cultural",
]);
export type ArticleDomain = z.infer<typeof ArticleDomainSchema>;

export const CitedSourceSchema = z.object({
  sourceType: z.enum(["doi", "handle", "url", "isbn"]),
  value: z.string().min(3).max(512),
});
export type CitedSource = z.infer<typeof CitedSourceSchema>;

export const ScientificClaimSchema = z.object({
  assertionId: z.string().uuid(),
  assertion: z.string().min(1).max(4096),
  citedSources: z.array(CitedSourceSchema).max(25).default([]),
});
export type ScientificClaim = z.infer<typeof ScientificClaimSchema>;

export const IngestedArtifactSchema = z.object({
  artifactId: z.string().min(1).max(128),
  name: z.string().max(256),
  mimeType: z.string().max(128),
  content: z.string().min(1).max(2_000_000),
});
export type IngestedArtifact = z.infer<typeof IngestedArtifactSchema>;

export const ScientificDocumentSchema = z.object({
  schema: z.literal("isabella.scientific-document.v1"),
  docId: z.string().min(1).max(128),
  title: z.string().min(1).max(512),
  authors: z
    .array(
      z.object({
        name: z.string().min(1).max(256),
        // ORCID ISO 27729: 0000-0000-0000-000X (16 caracteres; el último puede ser X).
        orcid: z.string().regex(/^[0-9]{4}-?[0-9]{4}-?[0-9]{4}-?[0-9]{3}[0-9X]$/).optional(),
      }),
    )
    .min(1)
    .max(20),
  domains: z.array(ArticleDomainSchema).min(1).max(5),
  abstract: z.string().min(1).max(12000),
  claims: z.array(ScientificClaimSchema).min(1).max(100),
  artifacts: z.array(IngestedArtifactSchema).max(50).default([]),
  createdAt: z.string().datetime(),
  tenantId: z.string().min(1).max(128),
});
export type ScientificDocument = z.infer<typeof ScientificDocumentSchema>;

export function parseScientificDocument(input: unknown):
  | { ok: true; value: ScientificDocument }
  | { ok: false; reason: string } {
  const parsed = ScientificDocumentSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, reason: `invalid_scientific_document:${parsed.error.issues[0]?.path.join(".") ?? "unknown"}` };
  }
  return { ok: true, value: parsed.data };
}

export const ScienceEventTypeSchema = z.enum([
  "ingest_event",
  "pipeline_run",
  "verification_event",
  "review_event",
  "certification_event",
  "revocation_event",
  "appeal_event",
]);
export type ScienceEventType = z.infer<typeof ScienceEventTypeSchema>;
export const SCIENCE_EVENT_TYPES = ScienceEventTypeSchema.options;

export interface ScienceLedgerBlock {
  seq: number;
  eventType: ScienceEventType;
  docId: string;
  payload: Record<string, unknown>;
  payloadHash: string;
  previousHash: string;
  currentHash: string;
  createdAt: string;
  signerId: string;
}

export const DECISION_WAIGHTS = {
  similarity: 0.35,
  refResolution: 0.2,
  repro: 0.25,
  statistics: 0.1,
  nlpClaims: 0.1,
} as const;

export const AGGREGATE_AUTO_VERIFIED = 0.9;
export const AGGREGATE_HUMAN_REVIEW = 0.7;
export const SIMILARITY_CRITICAL = 0.35;
export const REF_RESOLUTION_CRITICAL = 0.5;

export type PipelinePath = "AUTO_VERIFIED" | "HUMAN_REVIEW" | "REJECTED";
export type PipelineStatus =
  | "VERIFIED_PENDING_CERTIFICATION"
  | "PENDING_HUMAN_REVIEW"
  | "REJECTED_INSUFFICIENT_SIGNALS"
  | "REJECTED_EVIDENCE"
  | "FAIL_CLOSED";