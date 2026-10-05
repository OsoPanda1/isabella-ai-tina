/**
 * IGDS Genesis Document Seal Route (src/server-routes/api/igds.ts)
 * -------------------------------------------------------------
 * Endpoint delgado sobre src/lib/igds-service (orquestación configurada) y
 * src/lib/igds (autoridad criptográfica), implementando:
 * - JCS RFC 8785 canonicalization
 * - Ed25519 digital signature
 * - Merkle inclusion RFC 6962
 * - RFC 3161 Time-Stamp Authority (solo si IGDS_TSA_URL + verificador)
 *
 * Contrato de cuerpo: el histórico del endpoint (commit 2634a44). La
 * procedencia documental y generativa (IgdsDocumentAssertion /
 * IgdsGenerationAssertion) la aporta quien la conoce: esta ruta nunca
 * inventa procedencia ni aserciones de origen.
 */
import type { Request, Response } from "express";
import { z } from "zod";
import { IGDS_ACTION_NAMES, SEAL_PROFILES, type IgdsSealPackage } from "../../lib/igds";
import {
  createConfiguredIgdsService,
  sealWithService,
  verifyWithService,
} from "../../lib/igds-service";

const sealSchema = z.object({
  documentId: z.string().min(1).max(255),
  content: z.string().min(1),
  profile: z.enum(SEAL_PROFILES),
  document: z.object({
    title: z.string().min(1).max(300),
    mime_type: z.string().min(3).max(120),
    language: z.string().min(2).max(35),
    page_count: z.number().int().positive().max(100_000).optional(),
    byte_size: z.number().int().nonnegative().optional(),
  }),
  generation: z.object({
    system: z.string().min(1).max(120),
    skill: z.string().min(1).max(120),
    model_family: z.string().max(120).optional(),
    declaration: z.object({
      ai_generated: z.boolean(),
      ai_assisted: z.boolean(),
      human_modified: z.boolean(),
      human_reviewed: z.boolean(),
    }),
  }),
  actions: z
    .array(
      z.object({
        action: z.enum(IGDS_ACTION_NAMES),
        when: z.string().min(1).max(64),
      }),
    )
    .min(1),
});

const sealPackageSchema = z.custom<IgdsSealPackage>(
  (value) =>
    typeof value === "object" &&
    value !== null &&
    "seal" in value &&
    "manifest" in value &&
    "entry" in value,
  { message: "Seal package must contain seal, manifest and entry." },
);

const verifySchema = z.object({
  package: sealPackageSchema,
  content: z.unknown(),
});

function jsonIssues(error: z.ZodError): Array<{ path: PropertyKey[]; code: string }> {
  return error.issues.map((issue) => ({ path: issue.path, code: issue.code }));
}

/** Mapea errores de la capa IGDS a códigos HTTP (config → 503, sello → 422). */
function igdsError(error: unknown): { status: number; error: string } {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("IGDS_SIGNING_KEY") || message.includes("exige timestamp")) {
    return { status: 503, error: message };
  }
  if (message.includes("IGDS seal:") || message.includes("IGDS revocation:")) {
    return { status: 422, error: message };
  }
  return { status: 500, error: "IGDS_OPERATION_FAILED" };
}

export async function handleIgdsSeal(req: Request, res: Response): Promise<void> {
  const parsed = sealSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "INVALID_SEAL_REQUEST", issues: jsonIssues(parsed.error) });
    return;
  }

  try {
    const service = await createConfiguredIgdsService();
    const pkg = await sealWithService(parsed.data, service);
    res.status(200).json({
      success: true,
      seal: pkg.seal,
      manifest: pkg.manifest,
      entry: pkg.entry,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const mapped = igdsError(err);
    res.status(mapped.status).json({ error: mapped.error });
  }
}

export async function handleIgdsVerify(req: Request, res: Response): Promise<void> {
  const parsed = verifySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "INVALID_VERIFY_REQUEST", issues: jsonIssues(parsed.error) });
    return;
  }

  try {
    const service = await createConfiguredIgdsService();
    const report = await verifyWithService(parsed.data.package, service, {
      content: parsed.data.content,
    });
    res.status(200).json(report);
  } catch (err) {
    const mapped = igdsError(err);
    res.status(mapped.status).json({ valid: false, error: mapped.error });
  }
}

export default { handleIgdsSeal, handleIgdsVerify };
