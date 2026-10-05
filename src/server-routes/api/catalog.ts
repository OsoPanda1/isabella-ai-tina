import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { CATALOG_ENTRIES } from "@/lib/api-catalog";
import { routeRequest } from "@/lib/crown";
import { SecuritySystem } from "@/lib/security";
import { PrincipalContext } from "@/lib/principal-context";
import { resolveTrustedClientIp } from "@/lib/trusted-client-ip";

const executeSchema = z.object({
  id: z.string(),
  method: z.string(),
  path: z.string(),
  params: z.record(z.string(), z.unknown()).optional(),
});

export const Route = createFileRoute("/api/catalog")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const ip = resolveTrustedClientIp(request);
        const rateLimit = SecuritySystem.checkRateLimit(ip, 60); // 60 search requests/min allowed
        if (!rateLimit.allowed) {
          const headers = SecuritySystem.injectSecureHeaders(
            new Headers({ "content-type": "application/json" }),
          );
          return new Response(
            JSON.stringify({
              error: "Límite de solicitudes de catálogo excedido (60/min).",
            }),
            { status: 429, headers },
          );
        }

        const url = new URL(request.url);
        const domain = url.searchParams.get("domain") || undefined;
        const query = url.searchParams.get("query") || undefined;

        // --- LAYER 7: Content Sanitization ---
        if (query) {
          const checkQuery = SecuritySystem.sanitizePayload(query);
          if (checkQuery.flagged) {
            const headers = SecuritySystem.injectSecureHeaders(
              new Headers({ "content-type": "application/json" }),
            );
            return new Response(
              JSON.stringify({
                error: "Contenido de búsqueda sospechoso bloqueado.",
              }),
              {
                status: 403,
                headers,
              },
            );
          }
        }

        let items = CATALOG_ENTRIES;

        if (domain) {
          items = items.filter((i) => i.domain === domain);
        }

        if (query) {
          const lower = query.toLowerCase();
          items = items.filter(
            (i) =>
              i.id.toLowerCase().includes(lower) ||
              i.path.toLowerCase().includes(lower) ||
              i.description.toLowerCase().includes(lower),
          );
        }

        const headers = SecuritySystem.injectSecureHeaders(
          new Headers({
            "content-type": "application/json",
            "x-isabella-rate-remaining": rateLimit.remaining.toString(),
          }),
        );

        const publicItems = items.map((item) => ({ ...item }));

        return new Response(
          JSON.stringify({
            schema: "isabella.api.catalog.v1",
            total: CATALOG_ENTRIES.length,
            count: publicItems.length,
            items: publicItems,
          }),
          { headers },
        );
      },

      POST: async ({ request }) => {
        const authResult = await PrincipalContext.authorize(request, "isabella:chat");
        if (!authResult.success) return authResult.response;
        const { context } = authResult;
        if (context.role === "Guest") {
          return new Response(
            JSON.stringify({ error: "Autenticación requerida para ejecutar contratos." }),
            {
              status: 401,
              headers: SecuritySystem.injectSecureHeaders(
                new Headers({ "content-type": "application/json" }),
              ),
            },
          );
        }
        const ip = context.ip;
        const rateLimit = SecuritySystem.checkRateLimit(ip, 30); // 30 executions/min allowed
        if (!rateLimit.allowed) {
          const headers = SecuritySystem.injectSecureHeaders(
            new Headers({ "content-type": "application/json" }),
          );
          return new Response(
            JSON.stringify({
              error: "Límite de ejecución de contratos excedido (30/min).",
            }),
            { status: 429, headers },
          );
        }

        try {
          const startedAt = performance.now();
          let rawBody;
          try {
            rawBody = await request.json();
          } catch {
            const headers = SecuritySystem.injectSecureHeaders(
              new Headers({ "content-type": "application/json" }),
            );
            return new Response(JSON.stringify({ error: "Percepción de contrato corrupta." }), {
              status: 400,
              headers,
            });
          }

          // --- LAYER 1: Schema Integrity ---
          const validation = SecuritySystem.validateInput(executeSchema, rawBody);
          if (!validation.success) {
            const headers = SecuritySystem.injectSecureHeaders(
              new Headers({ "content-type": "application/json" }),
            );
            return new Response(JSON.stringify({ error: validation.error }), {
              status: 400,
              headers,
            });
          }

          const { id, method, path, params } = validation.data;

          // --- LAYER 7: Payload Integrity Check ---
          const serializedParams = JSON.stringify(params || {});
          const checkParams = SecuritySystem.sanitizePayload(serializedParams);
          if (checkParams.flagged) {
            const headers = SecuritySystem.injectSecureHeaders(
              new Headers({ "content-type": "application/json" }),
            );
            return new Response(
              JSON.stringify({
                error: `Parámetros de ejecución marcados como inseguros: ${checkParams.reason}`,
              }),
              { status: 403, headers },
            );
          }

          const entry = CATALOG_ENTRIES.find((e) => e.id === id);

          if (!entry) {
            const headers = SecuritySystem.injectSecureHeaders(
              new Headers({ "content-type": "application/json" }),
            );
            return new Response(
              JSON.stringify({
                error: "Contrato no registrado en el catálogo de Isabella.",
              }),
              { status: 404, headers },
            );
          }

          const expectedMethod = entry.method.toUpperCase();
          const expectedPath = entry.path;
          if (method.toUpperCase() !== expectedMethod || path !== expectedPath) {
            const headers = SecuritySystem.injectSecureHeaders(
              new Headers({ "content-type": "application/json" }),
            );
            return new Response(
              JSON.stringify({
                error: "El método o path no coincide con el contrato registrado.",
              }),
              { status: 409, headers },
            );
          }

          if (entry.status !== "implemented") {
            return new Response(
              JSON.stringify({
                error: "CONTRACT_NOT_IMPLEMENTED",
                message:
                  "El contrato está registrado, pero no tiene un handler productivo conectado.",
                contractId: id,
                status: entry.status,
              }),
              {
                status: 501,
                headers: SecuritySystem.injectSecureHeaders(
                  new Headers({ "content-type": "application/json" }),
                ),
              },
            );
          }

          const policyInput = `Invocación nativa del contrato ${id} [${method} ${path}] con parámetros: ${checkParams.clean}`;
          const { decision, auditEvents } = routeRequest(policyInput);

          // --- LAYER 6: Telemetry correlation ---
          const telemetry = SecuritySystem.generateTelemetry(
            ip,
            decision.policy.status === "allowed" ? "allowed" : "denied",
          );

          const latencyMs = Math.max(0, performance.now() - startedAt);

          const headers = SecuritySystem.injectSecureHeaders(
            new Headers({
              "content-type": "application/json",
              "x-isabella-trace-id": telemetry.traceId,
              "x-isabella-correlation-id": telemetry.correlationId,
              "x-isabella-rate-remaining": rateLimit.remaining.toString(),
            }),
          );

          return new Response(
            JSON.stringify({
              traceId: telemetry.traceId,
              contractId: id,
              method,
              path,
              // Señal real y gruesa derivada de la decisión CROWN (allowed=1).
              // No es un score probabilístico: el detalle está en riskLevel.
              governanceScore: decision.policy.status === "allowed" ? 1.0 : 0.0,
              decisionStatus: decision.policy.status,
              riskLevel: decision.policy.risk,
              allowedTools: decision.allowedTools,
              latencyMs,
              auditTrail: auditEvents,
              responsePayload: {
                status: "authorized_contract",
                resource: id,
                execution: "delegated_to_registered_handler",
              },
            }),
            { headers },
          );
        } catch {
          const headers = SecuritySystem.injectSecureHeaders(
            new Headers({ "content-type": "application/json" }),
          );
          return new Response(JSON.stringify({ error: "Error en la evaluación del contrato." }), {
            status: 500,
            headers,
          });
        }
      },
    },
  },
});
