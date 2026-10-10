import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { ApiKeyService } from "@/lib/api-key-service";
import { SecuritySystem } from "@/lib/security";
import { withSovereignAuth } from "@/lib/principal-context";

const MANAGE_SCOPE = "isabella:api-keys:manage";
const ROLE_VALUES = [
  "SovereignOwner",
  "Operator",
  "Auditor",
  "Guest",
  "System",
  "governance_admin",
] as const;
type ApiKeyRole = (typeof ROLE_VALUES)[number];

const createSchema = z.object({
  name: z.string().trim().min(1).max(150),
  role: z.enum(ROLE_VALUES).default("Operator"),
  scopes: z.array(z.string().trim().min(1).max(128)).min(1).max(64),
  expiresInSeconds: z.number().int().positive().optional(),
});

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: SecuritySystem.injectSecureHeaders(
      new Headers({
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      }),
    ),
  });
}

function requireManagementScope(context: { scope: string }): Response | null {
  const scopes = new Set(context.scope.split(/\s+/).filter(Boolean));
  return scopes.has(MANAGE_SCOPE)
    ? null
    : json({ error: "API_KEY_MANAGEMENT_SCOPE_REQUIRED", requiredScope: MANAGE_SCOPE }, 403);
}

function canIssueRole(callerRole: string, requestedRole: ApiKeyRole): boolean {
  if (callerRole === "SovereignOwner") return true;
  if (callerRole === "governance_admin") {
    return requestedRole !== "SovereignOwner";
  }
  return false;
}

export const Route = createFileRoute("/api/v1/api-keys")({
  server: {
    handlers: {
      GET: withSovereignAuth("system", "manage", async (context) => {
        const denied = requireManagementScope(context);
        if (denied) return denied;
        const keys = await ApiKeyService.listApiKeys(context.tenantId);
        return json({
          keys,
          count: keys.length,
          warning: "Secret material is never returned after key issuance.",
        });
      }),

      POST: withSovereignAuth("system", "manage", async (context, request) => {
        const denied = requireManagementScope(context);
        if (denied) return denied;

        let payload: unknown;
        try {
          payload = await request.clone().json();
        } catch {
          return json({ error: "INVALID_JSON" }, 400);
        }

        const parsed = createSchema.safeParse(payload);
        if (!parsed.success) {
          return json(
            {
              error: "INVALID_API_KEY_REQUEST",
              issues: parsed.error.issues.map((issue) => ({ path: issue.path, code: issue.code })),
            },
            400,
          );
        }

        if (!canIssueRole(context.role, parsed.data.role)) {
          return json({ error: "API_KEY_ROLE_ESCALATION_DENIED" }, 403);
        }

        // Nunca aceptar tenantId/ownerId desde el cliente: ambos derivan de PrincipalContext.
        try {
          const result = await ApiKeyService.createApiKey(
            context.tenantId,
            context.userId,
            parsed.data.name,
            parsed.data.role,
            parsed.data.scopes,
            parsed.data.expiresInSeconds,
            context.userId,
          );

          return json(
            {
              success: true,
              apiKey: result,
              warning:
                "Esta es la única respuesta que contiene el secreto completo. Guárdalo en un gestor de secretos.",
            },
            201,
          );
        } catch (error) {
          const code = error instanceof Error ? error.message : "api_key_creation_failed";
          const status =
            code === "invalid_api_key_ttl" || code === "invalid_api_key_scopes" ? 400 : 500;
          return json({ error: status === 500 ? "API_KEY_CREATION_FAILED" : code }, status);
        }
      }),

      DELETE: withSovereignAuth("system", "manage", async (context, request) => {
        const denied = requireManagementScope(context);
        if (denied) return denied;

        const keyId = new URL(request.url).searchParams.get("keyId")?.trim();
        if (!keyId || !z.string().uuid().safeParse(keyId).success) {
          return json({ error: "VALID_KEY_ID_REQUIRED" }, 400);
        }

        const revoked = await ApiKeyService.revokeApiKey(keyId, context.tenantId, context.userId);
        return revoked ? json({ success: true, keyId }) : json({ error: "API_KEY_NOT_FOUND" }, 404);
      }),
    },
  },
});
