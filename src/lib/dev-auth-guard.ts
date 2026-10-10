/**
 * DEV-AUTH GUARD (src/lib/dev-auth-guard.ts)
 * -----------------------------------------------------------------
 * Separación producción/desarrollo a nivel de módulo: las acciones de
 * autenticación de desarrollo (oauth-*, dev-session) NO existen en
 * producción. En modo production/staging responden 404 (superficie
 * oculta, no 403 que confirma existencia). En desarrollo delegan al
 * doble gate clásico (NODE_ENV + AUTH_DEV_SESSION_ENABLED).
 */

import { config } from "./config";
import { isProductionLike, resolveRuntimeMode } from "./runtime-mode";
import { SecuritySystem } from "./security";

export const DEV_AUTH_ACTIONS = [
  "oauth-url",
  "oauth-provider",
  "oauth-callback",
  "oauth-authorize-action",
  "dev-session",
] as const;

export type DevAuthAction = (typeof DEV_AUTH_ACTIONS)[number];

export function isDevAuthAction(action: string): action is DevAuthAction {
  return (DEV_AUTH_ACTIONS as readonly string[]).includes(action);
}

/**
 * Devuelve 404 si la superficie dev/test debe estar oculta (producción o
 * staging), o null si puede continuar (desarrollo).
 */
export function devSurfaceNotFound(): Response | null {
  let productionLike: boolean;
  try {
    productionLike = isProductionLike(resolveRuntimeMode(config().ISABELLA_RUNTIME_MODE));
  } catch {
    productionLike = true;
  }
  if (!productionLike) return null;
  const headers = SecuritySystem.injectSecureHeaders(
    new Headers({ "content-type": "application/json" }),
  );
  return new Response(JSON.stringify({ error: "Recurso no encontrado." }), {
    status: 404,
    headers,
  });
}

/**
 * Retorna una Response 404 si la acción dev-auth llega en producción,
 * o null si puede continuar (desarrollo con doble gate verificado
 * por el llamador vía isDevSessionEnabled()).
 */
export function devAuthNotFound(action: string): Response | null {
  // Fuera de la superficie dev-auth este guard NO aplica: las acciones
  // normales (session, ledger, emergency, payout, ...) tienen sus propios
  // controles. Aquí sólo se ocultan las acciones dev en producción.
  if (!isDevAuthAction(action)) return null;
  // La respuesta es siempre 404 genérico para no confirmar qué acciones
  // dev existen.
  return devSurfaceNotFound();
}

export const DEV_AUTH_GUARD = {
  actions: DEV_AUTH_ACTIONS,
  isDevAuthAction,
  notFound: devAuthNotFound,
};
