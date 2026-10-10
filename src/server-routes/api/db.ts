import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import * as nodeCrypto from "node:crypto";
import { COGNITIVE_HEADS, SovereignSandbox } from "@/lib/sovereign-engine";
import { sovereignStateRepository } from "@/lib/sovereign-state-repository";
import { prisma } from "@/lib/db";
import { createBookpiPostgresRepository } from "@/lib/repositories/bookpi-postgres-repository";
import type { LedgerCategory } from "@/lib/bookpi/types";
import { repositoryFactory } from "@/lib/persistence/repository-factory";
import { SecuritySystem } from "@/lib/security";
import { withSovereignAuth } from "@/lib/principal-context";
import { SovereignSandboxService } from "@/lib/sovereign-sandbox";
import { config, isPayoutCircuitCertified } from "@/lib/config";
import { devAuthNotFound, devSurfaceNotFound } from "@/lib/dev-auth-guard";

const addLedgerSchema = z.object({
  operation: z.string().min(1).max(200),
  category: z.enum(["inference", "processing", "apis", "skills", "other"]),
  cost: z.number().min(0).max(1000),
  tokens: z.number().nonnegative().default(0),
});

const executeToolSchema = z.object({
  expression: z.string().min(1).max(1000),
  variables: z.record(z.unknown()).optional(),
  useWasmSim: z.boolean().optional().default(false),
});

const provisionOwnerSchema = z.object({
  tenantId: z
    .string()
    .min(3)
    .max(64)
    .regex(/^[a-z0-9_-]+$/i),
  tenantName: z.string().min(1).max(128),
  ownerId: z
    .string()
    .min(3)
    .max(64)
    .regex(/^[a-zA-Z0-9_-]+$/),
  ownerUsername: z.string().min(1).max(64),
});

// ============================================================================
// OAuth manual (solo desarrollo) — códigos de un solo uso y validación de origen
// ============================================================================

const OAUTH_CODE_TTL_MS = 120_000;

interface OAuthCodeEntry {
  userId: string;
  redirectUri: string;
  expiresAt: number;
}

// Almacén en memoria de códigos de autorización de un solo uso.
const oauthCodes = new Map<string, OAuthCodeEntry>();

/**
 * Fail-closed: sesiones de desarrollo solo se habilitan cuando AMBAS condiciones
 * se cumplen — NODE_ENV === "development" Y AUTH_DEV_SESSION_ENABLED === true.
 * Si falta cualquiera de las dos, la puerta queda cerrada.
 */
function isDevSessionEnabled(): boolean {
  try {
    const runtime = config();
    return (
      runtime.NODE_ENV === "development" &&
      runtime.ISABELLA_RUNTIME_MODE === "development" &&
      runtime.AUTH_DEV_SESSION_ENABLED === true
    );
  } catch {
    // Un entorno incompleto debe producir 403, nunca un 500 de infraestructura.
    return false;
  }
}

function timingSafeEqualStrings(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  if (aBuf.length !== bBuf.length) return false;
  return nodeCrypto.timingSafeEqual(aBuf, bBuf);
}

function isSameOrigin(requestUrl: URL, redirectUri: string): boolean {
  try {
    const target = new URL(redirectUri);
    return target.origin === requestUrl.origin;
  } catch {
    return false;
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

function auditAccessAttempt(
  traceId: string,
  ip: string,
  event: string,
  details: string,
  severity: "S0" | "S1" | "S2" | "S3" = "S1",
): void {
  // Note: tenantId would need to be passed for production audit
  void sovereignStateRepository
    .appendAuditLog(traceId, `corr_${traceId}`, ip, event, severity, details, "system")
    .catch(() => {
      // La auditoría no debe convertir una sesión válida en un error 500 si el esquema aún no está migrado.
    });
}

export const Route = createFileRoute("/api/db")({
  server: {
    handlers: {
      GET: async ({ request }: IsabellaRouteContext) => {
        const url = new URL(request.url);
        const action = url.searchParams.get("action") || "session";

        // Separación prod/dev a nivel de módulo: las acciones dev-auth no
        // existen en producción (404, sin confirmar existencia).
        const dev404 = devAuthNotFound(action);
        if (dev404) return dev404;

        if (action === "session") {
          return withSovereignAuth("system", "read", async (context) => {
            const headers = SecuritySystem.injectSecureHeaders(
              new Headers({ "content-type": "application/json" }),
            );
            return new Response(
              JSON.stringify({
                session: {
                  userId: context.userId,
                  username: context.username,
                  tenantId: context.tenantId,
                  role: context.role,
                  oidcSub: `sub_oidc_${context.userId}`,
                },
                tenant: context.tenant,
              }),
              { headers },
            );
          })({ request });
        }

        if (action === "ledger") {
          return withSovereignAuth("ledger", "read", async (context) => {
            const headers = SecuritySystem.injectSecureHeaders(
              new Headers({ "content-type": "application/json" }),
            );
            const bookpi = createBookpiPostgresRepository();
            const ledger = await bookpi.list(context.tenantId);
            return new Response(JSON.stringify({ ledger }), { headers });
          })({ request });
        }

        if (action === "verify-ledger") {
          return withSovereignAuth("ledger", "verify", async (context) => {
            const headers = SecuritySystem.injectSecureHeaders(
              new Headers({ "content-type": "application/json" }),
            );
            const bookpi = createBookpiPostgresRepository();
            const result = await bookpi.verifyIntegrity(context.tenantId);
            if (result.success) {
              await sovereignStateRepository.appendAuditLog(
                context.traceId,
                context.correlationId,
                context.ip,
                "Auditoría Forense del Ledger Exitosa",
                "S3",
                "Integridad del libro de transacciones validada con éxito.",
                context.tenantId,
              );
            } else {
              await sovereignStateRepository.appendAuditLog(
                `trc_ledger_corrupt_${result.corruptedIndex}`,
                context.correlationId,
                context.ip,
                "¡BRECHA DE SEGURIDAD DETECTADA EN LEDGER!",
                "S0",
                `Fallo de integridad en Ledger: ${result.error}`,
                context.tenantId,
              );
            }
            return new Response(JSON.stringify(result), { headers });
          })({ request });
        }

        if (action === "verify-audit-chain") {
          return withSovereignAuth("audit", "verify", async (context) => {
            const headers = SecuritySystem.injectSecureHeaders(
              new Headers({ "content-type": "application/json" }),
            );
            const result = await sovereignStateRepository.verifyAuditChain();
            if (result.success) {
              await sovereignStateRepository.appendAuditLog(
                context.traceId,
                context.correlationId,
                context.ip,
                "Verificación de Cadena de Auditoría Exitosa",
                "S3",
                "La integridad criptográfica de la cadena de logs de auditoría (SHA-256) está intacta.",
                context.tenantId,
              );
            } else {
              await sovereignStateRepository.appendAuditLog(
                `trc_audit_corrupt_${result.corruptedId || "unknown"}`,
                context.correlationId,
                context.ip,
                "¡INTEGRIDAD DE REGISTROS DE AUDITORÍA VIOLADA!",
                "S0",
                `Fallo en validación de cadena: ${result.error}`,
                context.tenantId,
              );
            }
            return new Response(JSON.stringify(result), { headers });
          })({ request });
        }

        if (action === "test") {
          // ISA-13/S13: la suite de seguridad es un artefacto de test/dev.
          // En staging/production esta accion no existe (404) y el runner
          // jamas se importa dentro del bundle productivo (ademas de exigir
          // system:execute).
          const notFoundInProd = devSurfaceNotFound();
          if (notFoundInProd) return notFoundInProd;
          return withSovereignAuth("system", "execute", async (context) => {
            const headers = SecuritySystem.injectSecureHeaders(
              new Headers({ "content-type": "application/json" }),
            );
            const testResults = {
              success: false,
              status: "UNAVAILABLE",
              results: [],
              message:
                "La suite de seguridad se ejecuta únicamente mediante pnpm test:security y no está disponible como endpoint runtime.",
            };
            await sovereignStateRepository.appendAuditLog(
              context.traceId,
              context.correlationId,
              context.ip,
              "Auditoría de Sistemas Runtime No Disponible",
              "S2",
              "Se rechazó ejecutar pruebas de CI dentro del servidor de aplicación.",
              context.tenantId,
            );
            return new Response(JSON.stringify(testResults), { status: 501, headers });
          })({ request });
        }

        if (action === "audit") {
          return withSovereignAuth("audit", "read", async (context) => {
            const headers = SecuritySystem.injectSecureHeaders(
              new Headers({ "content-type": "application/json" }),
            );
            const auditLogs = await sovereignStateRepository.getAuditLogs(context.tenantId);
            return new Response(JSON.stringify({ auditLogs }), { headers });
          })({ request });
        }

        if (action === "heads") {
          return withSovereignAuth("system", "read", async () => {
            const headers = SecuritySystem.injectSecureHeaders(
              new Headers({ "content-type": "application/json" }),
            );
            return new Response(JSON.stringify({ heads: COGNITIVE_HEADS }), {
              headers,
            });
          })({ request });
        }

        if (action === "list-api-keys") {
          return withSovereignAuth("system", "read", async (context) => {
            const headers = SecuritySystem.injectSecureHeaders(
              new Headers({ "content-type": "application/json" }),
            );
            const { ApiKeyService } = await import("@/lib/api-key-service");
            const list = await ApiKeyService.listApiKeys(context.tenantId);
            return new Response(JSON.stringify({ keys: list }), { headers });
          })({ request });
        }

        if (action === "monetization-get") {
          return withSovereignAuth("system", "read", async (context) => {
            const headers = SecuritySystem.injectSecureHeaders(
              new Headers({ "content-type": "application/json" }),
            );
            const { prisma } = await import("@/lib/db");

            let account = await prisma.monetizationAccount.findUnique({
              where: { userId: context.userId },
            });
            if (!account) {
              // Fila durable real (ceros, sin sintéticos): nada transitorio.
              account = await prisma.monetizationAccount.create({
                data: { userId: context.userId },
              });
            }
            const { evaluateEligibility } = await import("@/lib/monetization/eligibility");
            // subscriptionActive desde el tenant durable (repository authority),
            // jamás de proyecciones en memoria. Fallo → false (fail-closed).
            let subscriptionActive: boolean;
            try {
              const tenantRepo = repositoryFactory.getTenantRepository();
              const tenant = await tenantRepo.read(context.tenantId, context.tenantId);
              const tier = String(tenant?.tier ?? "").toLowerCase();
              subscriptionActive = tier === "sovereign" || tier === "enterprise";
            } catch {
              subscriptionActive = false;
            }
            const eligibility = evaluateEligibility({
              subscriptionActive,
              identityVerified: account.identityVerified,
              paymentAccountVerified: account.paymentAccountVerified,
              profileComplete: account.profileComplete,
              trainingCompleted: account.trainingCompleted,
              qualifiedUses: account.qualifiedUses,
              minimumQualifiedUses: 10,
              approvedContributions: account.approvedContributions,
              requiredContributions: 1,
              availableBalanceCents: account.earnedBalanceCents,
              withdrawalMinimumCents: 5000, // $50.00 minimum
              sanctioned: account.sanctioned,
              underFraudReview: account.underFraudReview,
            });

            return new Response(JSON.stringify({ account, eligibility }), {
              headers,
            });
          })({ request });
        }

        // --- LAYER 3.2: Manual OAuth Endpoints (solo desarrollo / fail-closed) ---
        if (action === "oauth-url") {
          const headers = SecuritySystem.injectSecureHeaders(
            new Headers({ "content-type": "application/json" }),
          );
          if (!isDevSessionEnabled()) {
            auditAccessAttempt(
              `trc_oauth_${nodeCrypto.randomUUID().slice(0, 8)}`,
              SecuritySystem.resolveClientIp(request),
              "oauth.url_denied",
              "Flujo OAuth manual deshabilitado fuera del modo desarrollo.",
            );
            return new Response(
              JSON.stringify({
                error: "El flujo OAuth manual está deshabilitado en este modo.",
              }),
              { status: 403, headers },
            );
          }
          const rawRedirect = url.searchParams.get("redirect_uri") || "";
          if (rawRedirect && !isSameOrigin(url, rawRedirect)) {
            return new Response(
              JSON.stringify({
                error: "redirect_uri debe pertenecer al mismo origen.",
              }),
              { status: 400, headers },
            );
          }
          const redirectUri = rawRedirect || `${url.origin}/api/db?action=oauth-callback`;
          const clientId = url.searchParams.get("client_id") || "isabella_oauth_client";

          const providerUrl = `${url.origin}/api/db?action=oauth-provider&redirect_uri=${encodeURIComponent(redirectUri)}&client_id=${encodeURIComponent(clientId)}`;
          return new Response(JSON.stringify({ url: providerUrl }), {
            headers,
          });
        }

        if (action === "oauth-provider") {
          if (!isDevSessionEnabled()) {
            return new Response("Flujo OAuth manual deshabilitado en este modo.", {
              status: 403,
              headers: SecuritySystem.injectSecureHeaders(
                new Headers({ "content-type": "text/plain" }),
              ),
            });
          }
          const redirectUri = url.searchParams.get("redirect_uri") || "";
          if (!isSameOrigin(url, redirectUri)) {
            return new Response("redirect_uri inválido: debe pertenecer al mismo origen.", {
              status: 400,
            });
          }
          const clientId = url.searchParams.get("client_id") || "isabella_oauth_client";
          const systemSession = await sovereignStateRepository.getSession("system");
          const sessions = systemSession ? [systemSession] : [];

          const html = `
            <!DOCTYPE html>
            <html lang="es">
            <head>
              <meta charset="UTF-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
              <title>Isabella Sovereign IDP — Conexión OAuth 2.0</title>
              <style>
                body {
                  background-color: #0b0c10;
                  color: #e2e8f0;
                  font-family: system-ui, -apple-system, sans-serif;
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  min-height: 100vh;
                  margin: 0;
                  padding: 20px;
                  box-sizing: border-box;
                }
                .card {
                  background: rgba(17, 20, 28, 0.9);
                  border: 1px solid rgba(112, 102, 249, 0.3);
                  box-shadow: 0 10px 40px 0 rgba(112, 102, 249, 0.2);
                  border-radius: 16px;
                  padding: 32px;
                  max-width: 440px;
                  width: 100%;
                  text-align: center;
                }
                h1 {
                  color: #7066f9;
                  font-size: 22px;
                  margin-top: 12px;
                  margin-bottom: 8px;
                }
                .subtitle {
                  color: #94a3b8;
                  font-size: 13px;
                  margin-bottom: 24px;
                }
                .scope-box {
                  background: rgba(255, 255, 255, 0.03);
                  border: 1px solid rgba(255, 255, 255, 0.08);
                  border-radius: 8px;
                  padding: 12px;
                  text-align: left;
                  margin-bottom: 20px;
                  font-size: 12px;
                }
                .scope-item {
                  display: flex;
                  align-items: center;
                  gap: 8px;
                  margin-bottom: 6px;
                }
                .scope-item:last-child {
                  margin-bottom: 0;
                }
                .scope-bullet {
                  color: #10b981;
                  font-weight: bold;
                }
                select {
                  width: 100%;
                  background: #1e293b;
                  border: 1px solid rgba(255, 255, 255, 0.15);
                  color: #f8fafc;
                  padding: 10px;
                  border-radius: 8px;
                  font-size: 14px;
                  outline: none;
                  margin-bottom: 24px;
                  cursor: pointer;
                }
                .btn {
                  width: 100%;
                  background: #7066f9;
                  color: white;
                  border: none;
                  padding: 12px;
                  border-radius: 8px;
                  font-size: 14px;
                  font-weight: 600;
                  cursor: pointer;
                  transition: background 0.2s;
                }
                .btn:hover {
                  background: #5a50e5;
                }
                .footer {
                  margin-top: 20px;
                  font-size: 11px;
                  color: #64748b;
                }
              </style>
            </head>
            <body>
              <div class="card">
                <div style="font-size: 40px; margin-bottom: 8px;">🌸</div>
                <h1>Isabella Sovereign IDP</h1>
                <div class="subtitle">La identidad OIDC determina su rol de acceso mediante control estricto RBAC.</div>
                
                <form action="/api/db?action=oauth-authorize-action" method="POST">
                  <input type="hidden" name="redirect_uri" value="${encodeURIComponent(redirectUri)}">
                  <input type="hidden" name="client_id" value="${encodeURIComponent(clientId)}">
                  
                  <div class="scope-box">
                    <div style="font-weight: 600; margin-bottom: 8px; color: #f1f5f9;">Permisos Solicitados:</div>
                    <div class="scope-item"><span class="scope-bullet">✔</span> openid (Identidad de sesión única)</div>
                    <div class="scope-item"><span class="scope-bullet">✔</span> profile (Perfil soberano en Nodo Cero)</div>
                    <div class="scope-item"><span class="scope-bullet">✔</span> isabella:chat (Diálogo interactivo)</div>
                  </div>
                  
                  <div style="text-align: left; margin-bottom: 8px; font-size: 12px; color: #94a3b8; font-weight: 500;">Seleccionar Cuenta Soberana:</div>
                  <select name="userId">
                    ${sessions
                      .map(
                        (s) =>
                          `<option value="${s.userId}">${escapeHtml(s.username)} (${s.role})</option>`,
                      )
                      .join("")}
                  </select>
                  
                  <button type="submit" class="btn">Autorizar Acceso Seguro</button>
                </form>
                
                <div class="footer">
                  Seguridad C.R.O.W.N. • Real del Monte, Hidalgo, MX
                </div>
              </div>
            </body>
            </html>
          `;
          return new Response(html, {
            headers: new Headers({ "content-type": "text/html" }),
          });
        }

        if (action === "oauth-callback") {
          const ip = SecuritySystem.resolveClientIp(request);
          if (!isDevSessionEnabled()) {
            return new Response("Flujo OAuth manual deshabilitado en este modo.", {
              status: 403,
              headers: SecuritySystem.injectSecureHeaders(
                new Headers({ "content-type": "text/plain" }),
              ),
            });
          }
          const code = url.searchParams.get("code") || "";
          const entry = oauthCodes.get(code);
          oauthCodes.delete(code); // Consumir código de un solo uso inmediatamente

          if (!entry) {
            auditAccessAttempt(
              `trc_oauth_cb_${nodeCrypto.randomUUID().slice(0, 8)}`,
              ip,
              "oauth.callback_invalid_code",
              "Código de autorización inválido, expirado o ya utilizado.",
            );
            return new Response(
              "Error: Código de autorización inválido, expirado o ya utilizado.",
              { status: 400 },
            );
          }
          if (Date.now() > entry.expiresAt) {
            auditAccessAttempt(
              `trc_oauth_cb_${nodeCrypto.randomUUID().slice(0, 8)}`,
              ip,
              "oauth.callback_expired_code",
              "Código de autorización expirado.",
            );
            return new Response("Error: Código de autorización expirado.", {
              status: 400,
            });
          }
          if (!isSameOrigin(url, entry.redirectUri)) {
            auditAccessAttempt(
              `trc_oauth_cb_${nodeCrypto.randomUUID().slice(0, 8)}`,
              ip,
              "oauth.callback_origin_mismatch",
              "Origen de redirección inconsistente con el emitido.",
            );
            return new Response("Error: Origen de redirección inválido.", {
              status: 400,
            });
          }

          const session = await sovereignStateRepository.getSession(entry.userId);
          if (!session) {
            auditAccessAttempt(
              `trc_oauth_cb_${nodeCrypto.randomUUID().slice(0, 8)}`,
              ip,
              "oauth.callback_user_missing",
              "Usuario solicitado no registrado en el nodo.",
            );
            return new Response("Error: Usuario no encontrado en base de datos.", { status: 400 });
          }

          const scope = "isabella:chat isabella:ledger:write isabella:sandbox:run";
          const userToken = await SecuritySystem.generateSovereignToken(
            session.userId,
            session.role,
            session.tenantId,
            scope,
          );

          auditAccessAttempt(
            `trc_oidc_cb_${nodeCrypto.randomUUID().slice(0, 8)}`,
            ip,
            "oauth.callback_success",
            `Sesión OIDC emitida para ${session.username} (${session.role}).`,
            "S3",
          );

          // Valores únicamente de servidor, serializados como literales JS seguros.
          const targetOriginJson = JSON.stringify(url.origin);
          const userTokenJson = JSON.stringify(userToken);
          const sessionUserIdJson = JSON.stringify(session.userId);
          const sessionUsernameJson = JSON.stringify(session.username);
          const sessionRoleJson = JSON.stringify(session.role);

          const callbackHtml = `
            <!DOCTYPE html>
            <html>
            <head>
              <meta charset="utf-8">
              <title>Conexión Exitosa</title>
              <style>
                body {
                  background: #0b0c10;
                  color: #e2e8f0;
                  font-family: system-ui, sans-serif;
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  height: 100vh;
                  margin: 0;
                  text-align: center;
                }
                .msg {
                  background: rgba(16, 185, 129, 0.1);
                  border: 1px solid rgba(16, 185, 129, 0.3);
                  padding: 24px;
                  border-radius: 12px;
                  max-width: 380px;
                }
              </style>
            </head>
            <body>
              <div class="msg">
                <div style="font-size: 32px; margin-bottom: 12px;">✔</div>
                <h3 style="margin: 0 0 8px 0; color: #10b981;">Autenticación Completa</h3>
                <p style="margin: 0; font-size: 13px; color: #94a3b8;">La conexión con Isabella se ha verificado criptográficamente. Esta ventana se cerrará...</p>
              </div>
              <script>
                if (window.opener) {
                  window.opener.postMessage({
                    type: 'OAUTH_AUTH_SUCCESS',
                    token: ${userTokenJson},
                    userId: ${sessionUserIdJson},
                    username: ${sessionUsernameJson},
                    role: ${sessionRoleJson}
                  }, ${targetOriginJson});
                  setTimeout(() => { window.close(); }, 800);
                } else {
                  window.location.href = '/';
                }
              </script>
            </body>
            </html>
          `;
          return new Response(callbackHtml, {
            headers: new Headers({ "content-type": "text/html" }),
          });
        }

        const headers = SecuritySystem.injectSecureHeaders(
          new Headers({ "content-type": "application/json" }),
        );
        return new Response(JSON.stringify({ error: "Acción desconocida." }), {
          status: 400,
          headers,
        });
      },

      POST: async ({ request }: IsabellaRouteContext) => {
        const ip = SecuritySystem.resolveClientIp(request);
        const url = new URL(request.url);
        const action = url.searchParams.get("action");
        const headers = SecuritySystem.injectSecureHeaders(
          new Headers({ "content-type": "application/json" }),
        );

        const dev404Post = action ? devAuthNotFound(action) : null;
        if (dev404Post) return dev404Post;

        try {
          if (action === "oauth-authorize-action") {
            if (!isDevSessionEnabled()) {
              auditAccessAttempt(
                `trc_oauth_${nodeCrypto.randomUUID().slice(0, 8)}`,
                ip,
                "oauth.dev_flow_denied",
                "Intento de usar el flujo OAuth manual fuera del modo desarrollo.",
              );
              return new Response(
                JSON.stringify({
                  error: "Flujo OAuth manual deshabilitado en este modo.",
                }),
                { status: 403, headers },
              );
            }
            const formData = await request.formData();
            const redirectUriEnc = formData.get("redirect_uri") as string;
            const userId = formData.get("userId") as string;

            const redirectUri = decodeURIComponent(redirectUriEnc);
            if (!isSameOrigin(url, redirectUri)) {
              return new Response(
                JSON.stringify({
                  error: "redirect_uri inválido: mismo origen requerido.",
                }),
                { status: 400, headers },
              );
            }
            const session = await sovereignStateRepository.getSession(userId);
            if (!session) {
              return new Response(JSON.stringify({ error: "Usuario no registrado en el nodo." }), {
                status: 400,
                headers,
              });
            }

            const code = `authcode_${nodeCrypto.randomBytes(24).toString("hex")}`;
            oauthCodes.set(code, {
              userId,
              redirectUri,
              expiresAt: Date.now() + OAUTH_CODE_TTL_MS,
            });

            const targetUrl = `${redirectUri}${redirectUri.includes("?") ? "&" : "?"}code=${encodeURIComponent(code)}`;
            return new Response("", {
              status: 303,
              headers: new Headers({ Location: targetUrl }),
            });
          }

          // 1. Provisionamiento soberano del primer tenant/owner (bootstrap).
          //    NO es un endpoint de autenticación: requiere PROVISION_OWNER_TOKEN.
          if (action === "provision-owner") {
            const expectedToken = config().PROVISION_OWNER_TOKEN;
            const suppliedToken = (request.headers.get("x-isabella-api-key") || "").trim();

            if (!expectedToken || suppliedToken.length === 0) {
              auditAccessAttempt(
                `trc_prov_${nodeCrypto.randomUUID().slice(0, 8)}`,
                ip,
                "provision.owner_denied",
                "Provisionamiento soberano intentado sin token de bootstrap.",
              );
              return new Response(
                JSON.stringify({
                  error: "Provisionamiento de owner no autorizado.",
                }),
                { status: 403, headers },
              );
            }

            if (!timingSafeEqualStrings(expectedToken, suppliedToken)) {
              auditAccessAttempt(
                `trc_prov_${nodeCrypto.randomUUID().slice(0, 8)}`,
                ip,
                "provision.owner_invalid_token",
                "Token de bootstrap inválido para aprovisionar owner.",
              );
              return new Response(JSON.stringify({ error: "Token de bootstrap inválido." }), {
                status: 403,
                headers,
              });
            }

            const contentLength = parseInt(request.headers.get("content-length") || "0", 10);
            if (contentLength > 512 * 1024) {
              // 512KB limit for provision owner
              return new Response(JSON.stringify({ error: "Payload too large." }), {
                status: 413,
                headers,
              });
            }

            let provBody: unknown;
            try {
              provBody = await request.json();
            } catch {
              return new Response(JSON.stringify({ error: "Payload JSON inválido." }), {
                status: 400,
                headers,
              });
            }
            const parsedOwner = provisionOwnerSchema.safeParse(provBody);
            if (!parsedOwner.success) {
              return new Response(JSON.stringify({ error: "Esquema de provisión inválido." }), {
                status: 400,
                headers,
              });
            }
            const { tenantId, tenantName, ownerId, ownerUsername } = parsedOwner.data;

            const existingTenant = await sovereignStateRepository.getTenant(tenantId);
            if (existingTenant) {
              return new Response(JSON.stringify({ error: "El tenant ya existe." }), {
                status: 409,
                headers,
              });
            }

            await sovereignStateRepository.upsertTenant({
              id: tenantId,
              name: tenantName,
              region: "MX-HGO",
              quotaBalance: 0,
              tier: "Sovereign",
            });
            await sovereignStateRepository.upsertSession({
              userId: ownerId,
              username: ownerUsername,
              tenantId,
              role: "SovereignOwner",
              oidcSub: `provision|${ownerId}`,
            });

            auditAccessAttempt(
              `trc_prov_${nodeCrypto.randomUUID().slice(0, 8)}`,
              ip,
              "provision.owner_success",
              `Owner [${ownerId}] aprovisionado para tenant [${tenantId}].`,
              "S3",
            );

            return new Response(JSON.stringify({ success: true, tenantId, ownerId }), { headers });
          }

          // --- USER SIGNUP & LOGIN: NATIVE SOVEREIGN AUTHENTICATION ---
          if (action === "user-signup") {
            const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
            const signupSchema = z.object({
              email: z.string().email(),
              username: z.string().min(3).max(64),
              password: z.string().min(8).max(128),
              tenantSlug: z.string().optional(),
              // El rol NUNCA se acepta del cliente (P0-06); se deriva server-side.
            });
            const rateLimited = !SecuritySystem.checkRateLimit(`signup:ip:${ip}`, 5).allowed;
            if (rateLimited) {
              return new Response(
                JSON.stringify({ error: "Demasiados registros desde esta red." }),
                { status: 429, headers },
              );
            }
            const val = signupSchema.safeParse(body);
            if (!val.success) {
              return new Response(
                JSON.stringify({
                  error: "Datos de registro inválidos.",
                  details: val.error.format(),
                }),
                { status: 400, headers },
              );
            }
            const { UserAuthService } = await import("@/lib/user-auth-service");
            try {
              const res = await UserAuthService.signup({
                email: val.data.email,
                username: val.data.username,
                password: val.data.password,
                tenantSlug: val.data.tenantSlug,
                ip,
              });
              return new Response(JSON.stringify(res), { headers });
            } catch (err: unknown) {
              // Sin fuga de detalles internos: código estable + log correlacionado.
              const internalId = nodeCrypto.randomUUID().slice(0, 12);
              console.error(
                `[api/db:user-signup:${internalId}]`,
                err instanceof Error ? err.message : String(err),
              );
              return new Response(JSON.stringify({ error: "signup_failed", internalId }), {
                status: 400,
                headers,
              });
            }
          }

          if (action === "user-login") {
            const runtime = config();
            if (
              runtime.NODE_ENV === "production" ||
              runtime.ISABELLA_RUNTIME_MODE === "production" ||
              runtime.ISABELLA_RUNTIME_MODE === "staging"
            ) {
              return new Response(JSON.stringify({ error: "native_auth_disabled" }), {
                status: 403,
                headers,
              });
            }
            const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
            const loginSchema = z.object({
              email: z.string().email(),
              password: z.string().min(1),
            });
            const val = loginSchema.safeParse(body);
            if (!val.success) {
              return new Response(
                JSON.stringify({
                  error: "Correo o contraseña con formato incorrecto.",
                }),
                { status: 400, headers },
              );
            }
            // Rate limit por IP y por cuenta: frena fuerza bruta online y
            // amplificación de PBKDF2 (100k iteraciones por intento).
            const emailKey = val.data.email.trim().toLowerCase();
            if (!SecuritySystem.checkRateLimit(`login:ip:${ip}`, 15).allowed) {
              return new Response(
                JSON.stringify({ error: "rate_limited", retryAfterSeconds: 60 }),
                { status: 429, headers },
              );
            }
            if (!SecuritySystem.checkRateLimit(`login:account:${emailKey}`, 8).allowed) {
              return new Response(
                JSON.stringify({ error: "rate_limited_account", retryAfterSeconds: 60 }),
                { status: 429, headers },
              );
            }
            const { UserAuthService } = await import("@/lib/user-auth-service");
            try {
              const res = await UserAuthService.login({
                email: val.data.email,
                password: val.data.password,
                ip,
              });
              return new Response(JSON.stringify(res), { headers });
            } catch (err: unknown) {
              const internalId = nodeCrypto.randomUUID().slice(0, 12);
              console.error(
                `[api/db:user-login:${internalId}]`,
                err instanceof Error ? err.message : String(err),
              );
              return new Response(JSON.stringify({ error: "invalid_credentials", internalId }), {
                status: 401,
                headers,
              });
            }
          }

          // --- DEV SESSION: mock user para desarrollo local ---
          // Fail-closed: solo funciona cuando NODE_ENV=development Y
          // AUTH_DEV_SESSION_ENABLED=true. En staging/production esta acción
          // responde 403 y nunca emite tokens.
          if (action === "dev-session") {
            if (!isDevSessionEnabled()) {
              auditAccessAttempt(
                `trc_dev_${nodeCrypto.randomUUID().slice(0, 8)}`,
                ip,
                "dev.session_denied",
                "Sesión de desarrollo solicitada fuera del modo desarrollo.",
              );
              return new Response(
                JSON.stringify({
                  error: "Sesión de desarrollo no disponible en este modo.",
                }),
                { status: 403, headers },
              );
            }

            // Mock user: solo se usa para desarrollo local sin OAuth real.
            const DEV_USER = {
              userId: "dev_user_local",
              username: "Dev Admin",
              role: "SovereignOwner" as const,
              tenantId: "nodo-cero",
            };

            const tenantRepository = repositoryFactory.getTenantRepository();
            const existingTenant = await tenantRepository.read(
              DEV_USER.tenantId,
              DEV_USER.tenantId,
            );
            if (!existingTenant) {
              await tenantRepository.create(DEV_USER.tenantId, {
                id: DEV_USER.tenantId,
                slug: "nodo-cero",
                tier: "sovereign",
                quotaBalance: 0,
                quotaTierLimit: 1_000_000,
                createdAt: new Date().toISOString(),
                createdBy: DEV_USER.userId,
                metadata: { environment: "development", purpose: "preview-chat" },
              });
            }

            const devToken = await SecuritySystem.generateSovereignToken(
              DEV_USER.userId,
              DEV_USER.role,
              DEV_USER.tenantId,
              "isabella:chat isabella:ledger:write isabella:sandbox:run",
            );
            const tokenPayload = devToken.split(".")[1];
            const tokenClaims = tokenPayload
              ? (JSON.parse(Buffer.from(tokenPayload, "base64url").toString("utf8")) as {
                  jti?: string;
                })
              : {};
            if (!tokenClaims.jti) throw new Error("dev_session_missing_jti");

            const sessionRepository = repositoryFactory.getSessionRepository();
            await sessionRepository.create(`${DEV_USER.userId}:${tokenClaims.jti}`, {
              id: `${DEV_USER.userId}:${tokenClaims.jti}`,
              tenantId: DEV_USER.tenantId,
              userId: DEV_USER.userId,
              principalType: "user",
              tokenJti: tokenClaims.jti,
              expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
              createdAt: new Date().toISOString(),
            });

            auditAccessAttempt(
              `trc_dev_${nodeCrypto.randomUUID().slice(0, 8)}`,
              ip,
              "dev.session_issued",
              `Sesión de desarrollo emitida para ${DEV_USER.username} (${DEV_USER.role}).`,
              "S3",
            );

            return new Response(
              JSON.stringify({
                success: true,
                token: devToken,
                userId: DEV_USER.userId,
                username: DEV_USER.username,
                role: DEV_USER.role,
              }),
              { headers },
            );
          }

          // 2. Enforce verified centralized Authorization Wrapper for ledger & tool execution actions
          if (action === "ledger-add") {
            return withSovereignAuth("ledger", "write", async (context, _req, body) => {
              const val = addLedgerSchema.safeParse(body);
              if (!val.success) {
                return new Response(
                  JSON.stringify({
                    error: "Esquema inválido para transacciones.",
                  }),
                  { status: 400, headers },
                );
              }

              const bookpi = createBookpiPostgresRepository();
              const blockRes = await bookpi.append({
                tenantId: context.tenantId,
                userId: context.userId,
                operation: val.data.operation,
                category: val.data.category as LedgerCategory,
                cost: val.data.cost,
                tokens: val.data.tokens,
              });
              const block = blockRes.block ?? { index: -1 };

              await sovereignStateRepository.appendAuditLog(
                `trc_tx_${block.index}`,
                context.correlationId,
                context.ip,
                "Transacción Ledger Registrada",
                "S3",
                `Costo: $${val.data.cost} debitado para el tenant aislado ${context.tenantId}`,
                context.tenantId,
              );

              return new Response(JSON.stringify({ success: true, block }), {
                headers,
              });
            })({ request });
          }

          if (action === "ledger-refund") {
            return withSovereignAuth("ledger", "admin", async (context, _req, body) => {
              const { index } = (body ?? {}) as { index?: unknown };
              if (typeof index !== "number") {
                return new Response(JSON.stringify({ error: "Índice del bloque requerido." }), {
                  status: 400,
                  headers,
                });
              }

              const bookpi = createBookpiPostgresRepository();
              const res = await bookpi.refund(context.tenantId, index, "Refund requested");
              if (!res.success) {
                return new Response(JSON.stringify({ error: res.error }), {
                  status: 400,
                  headers,
                });
              }

              await sovereignStateRepository.appendAuditLog(
                `trc_rf_${index}`,
                context.correlationId,
                context.ip,
                "Reembolso Ledger Procesado",
                "S2",
                `Transacción index ${index} reembolsada para ${context.tenantId}`,
                context.tenantId,
              );

              return new Response(JSON.stringify({ success: true }), {
                headers,
              });
            })({ request });
          }

          if (action === "execute-tool") {
            return withSovereignAuth("sandbox", "execute", async (context, _req, body) => {
              const val = executeToolSchema.safeParse(body);
              if (!val.success) {
                return new Response(
                  JSON.stringify({
                    error: "Fórmula matemática o parámetros corruptos.",
                  }),
                  { status: 400, headers },
                );
              }

              let result;
              if (val.data.useWasmSim) {
                const sandbox = new SovereignSandboxService(context.traceId);
                await sandbox.provisionInstance(context.traceId);
                result = await sandbox.executeTask(
                  ["wasm-process", "math-expr"],
                  { TENANT_ID: context.tenantId },
                  JSON.stringify({
                    formula: val.data.expression,
                    vars: val.data.variables || {},
                  }),
                );
                await sandbox.deprovisionInstance();
              } else {
                result = SovereignSandbox.executeTool(
                  val.data.expression,
                  val.data.variables || {},
                );
              }

              await sovereignStateRepository.appendAuditLog(
                context.traceId,
                context.correlationId,
                context.ip,
                "Herramienta Ejecutada en Sandbox",
                result.success ? "S3" : "S1",
                `Fórmula: [${val.data.expression}]. Simulación WASM: ${val.data.useWasmSim ? "Habilitada" : "Deshabilitada"}.`,
                context.tenantId,
              );

              return new Response(JSON.stringify(result), { headers });
            })({ request });
          }

          if (action === "create-api-key") {
            return withSovereignAuth("system", "write", async (context, _req, body: unknown) => {
              const { name, role, scopes, expiresInSeconds } = (body || {}) as {
                name?: string;
                role?: string;
                scopes?: string[];
                expiresInSeconds?: number;
              };
              if (!name || !role || !scopes) {
                return new Response(
                  JSON.stringify({
                    error: "Faltan parámetros obligatorios (name, role, scopes).",
                  }),
                  { status: 400, headers },
                );
              }

              // FASE 2.2: Validar privilegios del emisor antes de emitir la credencial.
              // Un emisor nunca puede conceder un privilegio mayor al que posee.
              const { validateApiKeyIssue } = await import("@/lib/privilege-validation");
              const scopeList = Array.isArray(scopes)
                ? scopes
                : String(scopes).split(/\s+/).filter(Boolean);
              const issuerScopes = context.scope ? context.scope.split(/\s+/).filter(Boolean) : [];
              const issueParams: {
                issuerRole: string;
                issuerScopes: string[];
                issuerTenantId: string;
                requestedRole: string;
                requestedScopes: string[];
                requestedTenantId: string;
                requestedTtlSeconds?: number;
              } = {
                issuerRole: context.role,
                issuerScopes,
                issuerTenantId: context.tenantId,
                requestedRole: role,
                requestedScopes: scopeList,
                requestedTenantId: context.tenantId,
              };
              if (expiresInSeconds !== undefined)
                issueParams.requestedTtlSeconds = expiresInSeconds;
              const issueCheck = validateApiKeyIssue(issueParams);
              if (!issueCheck.allowed) {
                return new Response(
                  JSON.stringify({
                    error: `Emisión de credencial denegada: ${issueCheck.reason}.`,
                  }),
                  { status: 403, headers },
                );
              }

              const { ApiKeyService } = await import("@/lib/api-key-service");
              const result = await ApiKeyService.createApiKey(
                context.tenantId,
                context.userId,
                name,
                role,
                scopeList,
                expiresInSeconds,
              );
              return new Response(JSON.stringify({ success: true, key: result }), { headers });
            })({ request });
          }

          if (action === "revoke-api-key") {
            return withSovereignAuth("system", "write", async (context, _req, body: unknown) => {
              const { id } = (body || {}) as { id?: string };
              if (!id) {
                return new Response(JSON.stringify({ error: "ID de llave requerido." }), {
                  status: 400,
                  headers,
                });
              }
              const { ApiKeyService } = await import("@/lib/api-key-service");
              const success = await ApiKeyService.revokeApiKey(id, context.tenantId);
              return new Response(JSON.stringify({ success }), { headers });
            })({ request });
          }

          if (action === "rotate-api-key") {
            return withSovereignAuth("system", "write", async (context, _req, body: unknown) => {
              const { id } = (body || {}) as { id?: string };
              if (!id) {
                return new Response(JSON.stringify({ error: "ID de llave requerido." }), {
                  status: 400,
                  headers,
                });
              }
              const { ApiKeyService } = await import("@/lib/api-key-service");
              const result = await ApiKeyService.rotateApiKey(id, context.tenantId);
              if (!result.success) {
                return new Response(JSON.stringify({ error: result.error }), {
                  status: 400,
                  headers,
                });
              }
              return new Response(JSON.stringify({ success: true, key: result.newKey }), {
                headers,
              });
            })({ request });
          }

          // HITL: solicitar approval durable para ejecutar una herramienta.
          // Requiere DATABASE_URL (multi-instancia); sin ella, 503 honesto.
          if (action === "approval-request") {
            return withSovereignAuth("system", "write", async (context, _req, body: unknown) => {
              const { traceId, tool } = (body || {}) as {
                traceId?: string;
                tool?: string;
              };
              if (!traceId || !tool) {
                return new Response(JSON.stringify({ error: "traceId y tool requeridos." }), {
                  status: 400,
                  headers,
                });
              }
              if (!config().DATABASE_URL) {
                return new Response(
                  JSON.stringify({
                    error: "Approvals durables requieren DATABASE_URL (multi-instancia).",
                  }),
                  { status: 503, headers },
                );
              }
              const { grantApprovalAsync } = await import("@/lib/repositories/approval-repository");
              const grant = await grantApprovalAsync(
                traceId,
                tool,
                context.userId,
                context.tenantId,
              );
              return new Response(
                JSON.stringify({
                  success: true,
                  approvalId: grant.approvalId,
                  expiresAt: grant.expiresAt,
                }),
                { headers },
              );
            })({ request });
          }

          // HITL: estado de approval (vigente/consumido/ausente).
          if (action === "approval-status") {
            return withSovereignAuth("system", "read", async (context, _req, body: unknown) => {
              const { traceId, tool } = (body || {}) as {
                traceId?: string;
                tool?: string;
              };
              if (!traceId || !tool) {
                return new Response(JSON.stringify({ error: "traceId y tool requeridos." }), {
                  status: 400,
                  headers,
                });
              }
              if (!config().DATABASE_URL) {
                return new Response(
                  JSON.stringify({
                    error: "Approvals durables requieren DATABASE_URL.",
                  }),
                  { status: 503, headers },
                );
              }
              const { hasApprovalAsync } = await import("@/lib/repositories/approval-repository");
              const active = await hasApprovalAsync(
                traceId,
                tool,
                context.userId,
                context.tenantId,
              );
              return new Response(JSON.stringify({ success: true, active }), {
                headers,
              });
            })({ request });
          }

          // EMERGENCY (§7.1 Charter): engage/release/status del kill switch.
          // Solo SovereignOwner. Sin DATABASE_URL: 503 honesto (sin estado
          // durable no hay parada multi-instancia confiable).
          if (
            action === "emergency-engage" ||
            action === "emergency-release" ||
            action === "emergency-status"
          ) {
            return withSovereignAuth("system", "admin", async (context, _req, body: unknown) => {
              if (context.role !== "SovereignOwner") {
                return new Response(
                  JSON.stringify({
                    error: "Solo SovereignOwner opera el kill switch.",
                  }),
                  { status: 403, headers },
                );
              }
              if (!config().DATABASE_URL) {
                return new Response(
                  JSON.stringify({
                    error: "Kill switch durable requiere DATABASE_URL.",
                  }),
                  { status: 503, headers },
                );
              }
              const { createPostgresKillSwitchStore } = await import("@/lib/kill-switch");
              const store = createPostgresKillSwitchStore((event, details) => {
                void sovereignStateRepository.appendAuditLog(
                  `trc_emergency_${nodeCrypto.randomUUID().slice(0, 8)}`,
                  context.correlationId,
                  context.ip,
                  "Kill Switch Operado",
                  "S0",
                  `${event}: ${JSON.stringify(details)}`,
                  context.tenantId,
                );
              });
              if (action === "emergency-status") {
                const states = await store.list();
                return new Response(JSON.stringify({ success: true, states }), { headers });
              }
              const { capability, reason } = (body || {}) as {
                capability?: string;
                reason?: string;
              };
              if (!capability) {
                return new Response(JSON.stringify({ error: "capability requerida." }), {
                  status: 400,
                  headers,
                });
              }
              try {
                const state =
                  action === "emergency-engage"
                    ? await store.engage(
                        capability,
                        reason || "emergencia declarada",
                        context.userId,
                      )
                    : await store.release(capability, context.userId);
                return new Response(JSON.stringify({ success: true, state }), { headers });
              } catch (error) {
                const internalId = nodeCrypto.randomUUID().slice(0, 12);
                console.error(
                  `[api/db:emergency:${internalId}]`,
                  error instanceof Error ? error.message : String(error),
                );
                return new Response(
                  JSON.stringify({ error: "kill_switch_operation_failed", internalId }),
                  {
                    status: 400,
                    headers,
                  },
                );
              }
            })({ request });
          }

          if (action === "monetization-execute-task") {
            return withSovereignAuth("system", "write", async (context, _req, body: unknown) => {
              const { task } = (body || {}) as { task?: string };
              if (!task) {
                return new Response(JSON.stringify({ error: "Parámetro task requerido." }), {
                  status: 400,
                  headers,
                });
              }

              const taskCredits: Record<string, { cents: number; description: string }> = {
                gis: { cents: 150, description: "Provisión de mapas geográficos catastrales GIS" },
                compute: {
                  cents: 300,
                  description: "Sincronización de hardware local (Nodo de cómputo)",
                },
                skill: {
                  cents: 500,
                  description: "Licenciamiento comercial de habilidad cognitiva premium",
                },
                qec: {
                  cents: 820,
                  description: "Simulación correctora cuántica de errores (QEC)",
                },
                patrimony: {
                  cents: 75,
                  description: "Validación de metadatos históricos contra BookPI",
                },
              };
              const credit = taskCredits[task];
              if (!credit) {
                return new Response(JSON.stringify({ error: "Task desconocida." }), {
                  status: 400,
                  headers,
                });
              }
              const centsToAdd = credit.cents;
              const description = credit.description;

              let account = await prisma.monetizationAccount.findUnique({
                where: { userId: context.userId },
              });
              if (!account) {
                account = await prisma.monetizationAccount.create({
                  data: { userId: context.userId },
                });
              }
              const updated = await prisma.monetizationAccount.update({
                where: { userId: context.userId },
                data: {
                  earnedBalanceCents: account.earnedBalanceCents + centsToAdd,
                  qualifiedUses: account.qualifiedUses + 1,
                  approvedContributions:
                    task === "skill"
                      ? account.approvedContributions + 1
                      : account.approvedContributions,
                },
              });

              // Append block to ledger BookPI
              const bookpi = createBookpiPostgresRepository();
              const blockRes = await bookpi.append({
                tenantId: context.tenantId,
                userId: context.userId,
                operation: `MONETIZATION_CREDIT: ${description} (+$${(centsToAdd / 100).toFixed(2)} USD)`,
                category: "other" as LedgerCategory,
                cost: 0,
                // no deduction for credits earned
                tokens: 0,
              });
              const block = blockRes.block ?? { index: -1 };

              await sovereignStateRepository.appendAuditLog(
                `trc_mon_task_${block.index}`,
                context.correlationId,
                context.ip,
                "Crédito de Monetización Acreditado",
                "S3",
                `Monto de $${(centsToAdd / 100).toFixed(2)} USD asignado a ${context.userId} por tarea: ${task}`,
                context.tenantId,
              );

              return new Response(JSON.stringify({ success: true, account: updated }), { headers });
            })({ request });
          }

          if (action === "monetization-update-profile") {
            return withSovereignAuth("system", "write", async (context, _req, body: unknown) => {
              const {
                identityVerified,
                paymentAccountVerified,
                trainingCompleted,
                profileComplete,
                underFraudReview,
              } = (body || {}) as {
                identityVerified?: boolean;
                paymentAccountVerified?: boolean;
                trainingCompleted?: boolean;
                profileComplete?: boolean;
                underFraudReview?: boolean;
              };

              const updated = await prisma.monetizationAccount.update({
                where: { userId: context.userId },
                data: {
                  identityVerified: identityVerified !== undefined ? identityVerified : true,
                  paymentAccountVerified:
                    paymentAccountVerified !== undefined ? paymentAccountVerified : true,
                  trainingCompleted: trainingCompleted !== undefined ? trainingCompleted : true,
                  profileComplete: profileComplete !== undefined ? profileComplete : true,
                  underFraudReview: underFraudReview !== undefined ? underFraudReview : false,
                },
              });

              await sovereignStateRepository.appendAuditLog(
                `trc_mon_prof_${context.userId}`,
                context.correlationId,
                context.ip,
                "Perfil de Monetización Sincronizado",
                "S3",
                `Parámetros de elegibilidad actualizados para ${context.userId}`,
                context.tenantId,
              );

              return new Response(JSON.stringify({ success: true, account: updated }), { headers });
            })({ request });
          }

          if (action === "monetization-request-withdrawal") {
            return withSovereignAuth("system", "write", async (context, _req, body: unknown) => {
              // P0-C: fail-closed. En staging/production los payouts quedan
              // FUERA DE SERVICIO hasta certificar los circuitos financieros
              // A–J (ISABELLA_PAYOUT_CIRCUIT_CERTIFIED=true documentado en
              // PRODUCTION_REPAIR_REGISTER). Sin certificación → 503 y cero
              // movimiento de fondos (real o programado).
              const payoutRuntime = config();
              const payoutProductionLike =
                payoutRuntime.NODE_ENV === "production" ||
                payoutRuntime.ISABELLA_RUNTIME_MODE === "production" ||
                payoutRuntime.ISABELLA_RUNTIME_MODE === "staging";
              if (payoutProductionLike && !isPayoutCircuitCertified()) {
                return new Response(
                  JSON.stringify({
                    error: "payouts_locked",
                    traceId: `trc_payout_lock_${nodeCrypto.randomUUID().slice(0, 8)}`,
                    message:
                      "Movimientos de dinero bloqueados: circuitos financieros A–J sin certificar (ISABELLA_PAYOUT_CIRCUIT_CERTIFIED).",
                  }),
                  { status: 503, headers },
                );
              }

              const { idempotencyKey, destinationAccountId } = (body || {}) as {
                idempotencyKey?: string;
                destinationAccountId?: string;
              };

              const { WithdrawalService } = await import("@/lib/monetization/withdrawal");
              const deps = {
                getEligibility: async (uid: string) => {
                  const acc = await prisma.monetizationAccount.findUnique({
                    where: { userId: uid },
                  });
                  if (!acc) throw new Error("No account");
                  const { evaluateEligibility } = await import("@/lib/monetization/eligibility");
                  let withdrawalSubscriptionActive: boolean;
                  try {
                    const tenantRepo = repositoryFactory.getTenantRepository();
                    const tenant = await tenantRepo.read(context.tenantId, context.tenantId);
                    const tier = String(tenant?.tier ?? "").toLowerCase();
                    withdrawalSubscriptionActive = tier === "sovereign" || tier === "enterprise";
                  } catch {
                    withdrawalSubscriptionActive = false;
                  }
                  return evaluateEligibility({
                    subscriptionActive: withdrawalSubscriptionActive,
                    identityVerified: acc.identityVerified,
                    paymentAccountVerified: acc.paymentAccountVerified,
                    profileComplete: acc.profileComplete,
                    trainingCompleted: acc.trainingCompleted,
                    qualifiedUses: acc.qualifiedUses,
                    minimumQualifiedUses: 10,
                    approvedContributions: acc.approvedContributions,
                    requiredContributions: 1,
                    availableBalanceCents: acc.earnedBalanceCents,
                    withdrawalMinimumCents: 5000,
                    sanctioned: acc.sanctioned,
                    underFraudReview: acc.underFraudReview,
                  });
                },
                runRiskReview: async (uid: string) => {
                  const acc = await prisma.monetizationAccount.findUnique({
                    where: { userId: uid },
                  });
                  if (!acc) throw new Error("No account");
                  // Riesgo REAL vía fraud-review (determinista, auditable),
                  // no hardcoded. Velocidad desconocida aquí → 0 documentado.
                  const { evaluateWithdrawalRisk } =
                    await import("@/lib/monetization/fraud-review");
                  const accountAgeDays = Math.max(
                    0,
                    Math.floor((Date.now() - new Date(acc.createdAt).getTime()) / 86_400_000),
                  );
                  const evaluation = evaluateWithdrawalRisk({
                    userId: uid,
                    amountCents: acc.earnedBalanceCents,
                    accountAgeDays,
                    withdrawalsLast24h: 0,
                    failedAttemptsLast24h: 0,
                    sanctioned: acc.sanctioned,
                    underFraudReview: acc.underFraudReview,
                    identityVerified: acc.identityVerified,
                  });
                  return {
                    reviewId: evaluation.reviewId,
                    status: evaluation.status,
                    score: evaluation.score,
                    signals: evaluation.signals,
                  };
                },
                isIdempotent: async (key: string) => {
                  // Idempotencia ATÓMICA real: INSERT ... ON CONFLICT sobre
                  // UNIQUE(tenant_id, idempotency_key) en economic_events.
                  // El primer llamador inserta (no duplicado); los siguientes
                  // chocan con la constraint (duplicado). Sin carreras.
                  const { recordEconomicEvent } = await import("@/lib/economic-events");
                  const claimed = await recordEconomicEvent({
                    tenantId: context.tenantId,
                    actorId: context.userId,
                    eventType: "WITHDRAWAL_REQUEST",
                    amountMinor: 0,
                    direction: "DEBIT",
                    source: "internal",
                    idempotencyKey: `withdrawal:${key}`,
                  });
                  return claimed.duplicate === true;
                },
                // Sin efecto: el claim ya ocurrió atómicamente en isIdempotent.
                markIdempotent: async () => {},
                appendBookPI: async (entry: {
                  type: string;
                  amountCents?: number;
                  userId: string;
                  payoutId?: string;
                  riskScore?: number;
                  idempotencyKey?: string;
                }) => {
                  const cost = entry.amountCents ? entry.amountCents / 100 : 0;
                  const bookpi = createBookpiPostgresRepository();
                  await bookpi.append({
                    tenantId: context.tenantId,
                    userId: entry.userId,
                    operation: `MONETIZATION_EVENT: ${entry.type} (payoutId:${entry.payoutId || "N/A"}) (risk:${entry.riskScore || 0}) (idempotencyKey:${entry.idempotencyKey || "N/A"})`,
                    category: "other" as LedgerCategory,
                    cost: cost,
                    tokens: 0,
                  });
                },
                checkLiquidityPool: async () => true,
                createPayout: async (payoutRequest: {
                  userId: string;
                  amountCents: number;
                  idempotencyKey: string;
                }) => {
                  // Ejecución REAL cuando el usuario provee cuenta destino
                  // (Stripe Transfer idempotente con el monto verificado).
                  // Sin destino: programado manual, sin movimiento de fondos.
                  if (typeof destinationAccountId === "string" && destinationAccountId.length > 0) {
                    const { executePayout } = await import("@/lib/monetization/payout-executor");
                    const executed = await executePayout({
                      amountCents: payoutRequest.amountCents,
                      destinationAccountId,
                      idempotencyKey: `payout:${payoutRequest.idempotencyKey}`,
                      metadata: {
                        tenantId: context.tenantId,
                        userId: payoutRequest.userId,
                      },
                    });
                    return {
                      payoutId: executed.payoutId,
                      status: executed.status,
                    };
                  }
                  return {
                    payoutId: `pay_${nodeCrypto.randomUUID().slice(0, 8)}`,
                    status: "scheduled" as const,
                  };
                },
              };

              const service = new WithdrawalService(deps);
              const result = await service.request(context.userId, "default-territory", {
                idempotencyKey,
              });

              if (result.ok) {
                // Reset earned balance to 0 on success
                const currentAccount = await prisma.monetizationAccount.findUnique({
                  where: { userId: context.userId },
                });
                if (!currentAccount) throw new Error("No account");
                const updated = await prisma.monetizationAccount.update({
                  where: { userId: context.userId },
                  data: {
                    earnedBalanceCents: 0,
                  },
                });

                await sovereignStateRepository.appendAuditLog(
                  `trc_mon_with_${result.payoutId || "N/A"}`,
                  context.correlationId,
                  context.ip,
                  "Retiro de Monetización Procesado",
                  "S3",
                  result.payoutId?.startsWith("tr_")
                    ? `Usuario ${context.userId} retiró $${(currentAccount.earnedBalanceCents / 100).toFixed(2)} USD vía Stripe. ID: ${result.payoutId}`
                    : `Usuario ${context.userId} programó retiro de $${(currentAccount.earnedBalanceCents / 100).toFixed(2)} USD (ejecución manual pendiente). ID: ${result.payoutId || "N/A"}`,
                  context.tenantId,
                );

                return new Response(
                  JSON.stringify({
                    success: true,
                    payoutId: result.payoutId,
                    account: updated,
                  }),
                  { headers },
                );
              } else {
                return new Response(
                  JSON.stringify({
                    success: false,
                    code: result.code,
                    reasons: (result as { reasons?: string[] }).reasons || [],
                  }),
                  { status: 400, headers },
                );
              }
            })({ request });
          }

          if (action === "qup-run") {
            return withSovereignAuth("sandbox", "execute", async (context, _req, body: unknown) => {
              const qupRunSchema = z.object({
                dataset: z.object({
                  name: z.string().min(1).max(100),
                  features: z.array(z.record(z.unknown())).min(1),
                }),
                backend: z.enum(["ibm_sherbrooke_qpu", "aer_simulator_local", "aws_braket_dm1"]),
                config: z.object({
                  qubitCount: z.number().min(2).max(100),
                  circuitDepth: z.number().min(5).max(500),
                  objective: z.enum([
                    "hamiltonian_spectrum",
                    "qml_classification",
                    "qec_syndrome",
                    "quantum_simulation",
                  ]),
                  errorMitigation: z.array(z.enum(["ZNE", "PEC", "TREX"])).default([]),
                  errorCorrection: z
                    .enum(["toric_code_L3", "toric_code_L5", "none"])
                    .default("none"),
                  classicalBaseline: z
                    .enum(["xgboost", "pytorch_mlp", "jax_ode"])
                    .default("xgboost"),
                }),
              });

              const val = qupRunSchema.safeParse(body);
              if (!val.success) {
                return new Response(
                  JSON.stringify({
                    error:
                      "Parámetros de configuración de experimento cuántico corruptos o faltantes.",
                    details: val.error.format(),
                  }),
                  { status: 400, headers },
                );
              }

              const { QupOrchestrator } = await import("@/lib/qup-v3-engine");
              const result = await QupOrchestrator.executeExperiment(
                context.tenantId,
                context.userId,
                context.role,
                context.traceId,
                val.data,
              );

              return new Response(JSON.stringify({ success: true, result }), {
                headers,
              });
            })({ request });
          }

          if (action === "pennylane-run") {
            return withSovereignAuth("sandbox", "execute", async (context, _req, body: unknown) => {
              const pennylaneSchema = z.object({
                qubits: z.number().min(2).max(16).default(4),
                depth: z.number().min(1).max(20).default(3),
                objective: z
                  .enum(["vqe_hamiltonian", "qml_classification", "bell_state_tomography"])
                  .default("vqe_hamiltonian"),
              });

              const val = pennylaneSchema.safeParse(body);
              if (!val.success) {
                return new Response(
                  JSON.stringify({
                    error: "Parámetros de PennyLane inválidos.",
                    details: val.error.format(),
                  }),
                  { status: 400, headers },
                );
              }

              const { PennyLaneBridge } = await import("@/lib/quantum/pennylane-bridge");
              const job = await PennyLaneBridge.runPennyLaneJob(
                context.tenantId,
                context.userId,
                val.data.qubits,
                val.data.depth,
                val.data.objective,
              );

              return new Response(JSON.stringify({ success: true, job }), { headers });
            })({ request });
          }

          return new Response(JSON.stringify({ error: "Acción de escritura desconocida." }), {
            status: 400,
            headers,
          });
        } catch (e: unknown) {
          // P0-48: no exponer detalles internos al cliente. Separar error interno
          // de un mensaje público estable, registrando el detalle en logs protegidos.
          const internalId = nodeCrypto.randomUUID().slice(0, 8);
          const internalMessage =
            e instanceof Error ? e.message : "Error en el pipeline transaccional de base de datos.";
          // Registro interno (no expone el mensaje al cliente)
          console.error(`[api/db:${internalId}] ${internalMessage}`);
          return new Response(
            JSON.stringify({
              error: "internal_error",
              traceId: `trc_${internalId}`,
            }),
            { status: 500, headers },
          );
        }
      },
    },
  },
});
