import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { SecuritySystem } from "@/lib/security";
import { withSovereignAuth } from "@/lib/principal-context";
import { config } from "@/lib/config";
import {
  IGDS_ACTION_NAMES,
  REVOCATION_REASONS,
  REVOCATION_SCOPES,
  REVOCATION_TARGET_TYPES,
  verifyGenesisChain,
  type IgdsSealPackage,
  type RevocationReason,
  type RevocationScope,
  type RevocationTargetType,
} from "@/lib/igds";
import {
  checkpointWithService,
  createConfiguredIgdsService,
  revokeWithService,
  sealWithService,
  verifyWithService,
} from "@/lib/igds-service";

/**
 * API server-side de IGDS (Isabella Genesis Document Seal).
 * Rutas delgadas: la autoridad criptográfica vive en src/lib/igds y la
 * orquestación configurada en src/lib/igds-service.
 */

function json(data: unknown, status: number, headers: Headers): Response {
  return new Response(JSON.stringify(data), { status, headers });
}

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

const sealSchema = z.object({
  documentId: z.string().min(1).max(255),
  content: z.string().min(1),
  profile: z.enum(["internal", "public-verifiable", "long-term", "restricted"]),
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

const verifySchema = z.object({
  package: z.unknown(),
  content: z.string().optional(),
});

const revokeSchema = z.object({
  revocationId: z.string().min(1).max(160),
  targetType: z.enum(REVOCATION_TARGET_TYPES as [RevocationTargetType, ...RevocationTargetType[]]),
  targetId: z.string().min(1).max(255),
  reason: z.enum(REVOCATION_REASONS as [RevocationReason, ...RevocationReason[]]),
  scope: z.enum(REVOCATION_SCOPES as [RevocationScope, ...RevocationScope[]]).optional(),
  issuedBy: z.string().min(1).max(255),
  effectiveAt: z.string().min(1).max(64).optional(),
});

export const Route = createFileRoute("/api/igds")({
  server: {
    handlers: {
      GET: async ({ request }: IsabellaRouteContext) => {
        const url = new URL(request.url);
        const action = url.searchParams.get("action") ?? "entries";
        const headers = SecuritySystem.injectSecureHeaders(
          new Headers({ "content-type": "application/json" }),
        );

        if (action === "entries" || action === "head" || action === "checkpoint") {
          return withSovereignAuth("audit", "read", async () => {
            try {
              const { createPostgresGenesisRegistry } =
                await import("@/lib/repositories/igds-genesis-repository");
              const registry = createPostgresGenesisRegistry();

              if (action === "head") {
                const [head, size] = await Promise.all([registry.head(), registry.size()]);
                return json({ success: true, head, size }, 200, headers);
              }
              if (action === "checkpoint") {
                const service = await createConfiguredIgdsService();
                const checkpoint = await checkpointWithService(service);
                return json({ success: true, checkpoint }, 200, headers);
              }
              const limit = Math.min(
                Math.max(Number(url.searchParams.get("limit") ?? 50) || 50, 1),
                500,
              );
              const entries = await registry.list(limit);
              return json(
                { success: true, entries, chainVerified: verifyGenesisChain(entries).success },
                200,
                headers,
              );
            } catch (error) {
              const mapped = igdsError(error);
              return json({ error: mapped.error }, mapped.status, headers);
            }
          })({ request });
        }

        return json({ error: "Acción GET desconocida." }, 400, headers);
      },

      POST: async ({ request }: IsabellaRouteContext) => {
        const url = new URL(request.url);
        const action = url.searchParams.get("action");
        const headers = SecuritySystem.injectSecureHeaders(
          new Headers({ "content-type": "application/json" }),
        );
        if (!action) {
          return json({ error: "Parámetro action requerido en POST." }, 400, headers);
        }

        try {
          const bodyText = await request.text();
          if (new TextEncoder().encode(bodyText).byteLength > config().INPUT_MAX_BODY_BYTES) {
            return json({ error: "REQUEST_BODY_TOO_LARGE" }, 413, headers);
          }
          const body = bodyText ? JSON.parse(bodyText) : {};

          if (action === "seal") {
            return withSovereignAuth("system", "write", async () => {
              const parsed = sealSchema.safeParse(body);
              if (!parsed.success) {
                return json({ error: "Datos de sellado inválidos." }, 400, headers);
              }
              try {
                const service = await createConfiguredIgdsService();
                const pkg = await sealWithService(parsed.data, service);
                return json({ success: true, ...pkg }, 201, headers);
              } catch (error) {
                const mapped = igdsError(error);
                return json({ error: mapped.error }, mapped.status, headers);
              }
            })({ request });
          }

          if (action === "verify") {
            return withSovereignAuth("system", "read", async () => {
              const parsed = verifySchema.safeParse(body);
              if (!parsed.success) {
                return json({ error: "Paquete de verificación inválido." }, 400, headers);
              }
              try {
                const service = await createConfiguredIgdsService();
                const report = await verifyWithService(
                  parsed.data.package as IgdsSealPackage,
                  service,
                  { content: parsed.data.content },
                );
                return json({ success: true, report }, 200, headers);
              } catch (error) {
                const mapped = igdsError(error);
                return json({ error: mapped.error }, mapped.status, headers);
              }
            })({ request });
          }

          if (action === "revoke") {
            return withSovereignAuth("system", "write", async () => {
              const parsed = revokeSchema.safeParse(body);
              if (!parsed.success) {
                return json({ error: "Datos de revocación inválidos." }, 400, headers);
              }
              try {
                const service = await createConfiguredIgdsService();
                const entry = await revokeWithService(parsed.data, service);
                return json({ success: true, entry }, 201, headers);
              } catch (error) {
                const mapped = igdsError(error);
                return json({ error: mapped.error }, mapped.status, headers);
              }
            })({ request });
          }

          return json({ error: "Acción POST desconocida." }, 400, headers);
        } catch (error) {
          console.error("[api/igds] fallo inesperado:", error);
          return json({ error: "IGDS_INTERNAL_ERROR" }, 500, headers);
        }
      },
    },
  },
});
