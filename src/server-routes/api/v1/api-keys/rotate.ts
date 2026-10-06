import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { ApiKeyService } from "@/lib/api-key-service";
import { SecuritySystem } from "@/lib/security";
import { withSovereignAuth } from "@/lib/principal-context";

const MANAGE_SCOPE = "isabella:api-keys:manage";
const bodySchema = z.object({ keyId: z.string().uuid() });

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

export const Route = createFileRoute("/api/v1/api-keys/rotate")({
  server: {
    handlers: {
      POST: withSovereignAuth("system", "manage", async (context, request) => {
        const scopes = new Set(context.scope.split(/\s+/).filter(Boolean));
        if (!scopes.has(MANAGE_SCOPE)) {
          return json(
            { error: "API_KEY_MANAGEMENT_SCOPE_REQUIRED", requiredScope: MANAGE_SCOPE },
            403,
          );
        }

        let payload: unknown;
        try {
          payload = await request.clone().json();
        } catch {
          return json({ error: "INVALID_JSON" }, 400);
        }
        const parsed = bodySchema.safeParse(payload);
        if (!parsed.success) return json({ error: "VALID_KEY_ID_REQUIRED" }, 400);

        const result = await ApiKeyService.rotateApiKey(
          parsed.data.keyId,
          context.tenantId,
          context.userId,
        );
        if (!result.success || !result.newKey) {
          return json({ error: result.error ?? "API_KEY_ROTATION_FAILED" }, 404);
        }

        return json({
          success: true,
          apiKey: result.newKey,
          revokedKeyId: parsed.data.keyId,
          warning:
            "La clave anterior fue revocada. Guarda el nuevo secreto ahora; no volverá a mostrarse.",
        });
      }),
    },
  },
});
