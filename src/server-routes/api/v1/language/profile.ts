import { createFileRoute } from "@tanstack/react-router";
import { withSovereignAuth } from "@/lib/principal-context";
import { SecuritySystem } from "@/lib/security";
import { classifyIntent, buildLanguageDirectives } from "@/lib/language/language-core";
import { CROWN_V6 } from "@/lib/crown-v6";

export const Route = createFileRoute("/api/v1/language/profile")({
  server: {
    handlers: {
      POST: withSovereignAuth("system", "read", async (ctx, req) => {
        const body = await req.json().catch(() => ({}));
        const text = String(body.text || body.message || "").slice(0, 4000);
        const sanitized = SecuritySystem.sanitizePayload(text);
        if (sanitized.flagged) {
          return new Response(JSON.stringify({ error: sanitized.reason }), {
            status: 403,
            headers: SecuritySystem.injectSecureHeaders(new Headers()),
          });
        }
        const profile = classifyIntent(sanitized.clean);
        const directives = buildLanguageDirectives(profile);
        return new Response(
          JSON.stringify({
            meta: {
              requestId: ctx.correlationId,
              traceId: ctx.traceId,
              tenantId: ctx.tenantId,
              crownVersion: CROWN_V6.version,
            },
            data: { profile, directives, nodes: CROWN_V6.nodes.length },
            error: null,
          }),
          {
            headers: SecuritySystem.injectSecureHeaders(
              new Headers({ "content-type": "application/json" }),
            ),
          },
        );
      }),
    },
  },
});
