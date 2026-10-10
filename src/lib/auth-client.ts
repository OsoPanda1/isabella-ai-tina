/**
 * CLIENTE DE AUTENTICACIÓN SOBERANA (src/lib/auth-client.ts)
 * -----------------------------------------------------------------
 * Única vía para que la UI conozca la identidad del nodo y su token de
 * sesión. Este módulo NUNCA acuña tokens por su cuenta: el servidor solo
 * entrega tokens mediante flujos autorizados (OAuth manual en desarrollo
 * o IDP OIDC/Supabase en producción).
 */

const SESSION_TOKEN_KEY = "isabella_session_token";
const SOVEREIGN_USER_ID_KEY = "isabella.sovereign.userId";

/** Devuelve el token de sesión vigente (si existe). No acuña nada. */
export function getSessionToken(): string {
  try {
    return window.sessionStorage.getItem(SESSION_TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

/** Persiste un token de sesión emitido por el servidor. */
export function setSessionToken(token: string): void {
  try {
    window.sessionStorage.setItem(SESSION_TOKEN_KEY, token);
  } catch {
    // Almacenamiento no disponible: el token se mantendrá solo en memoria.
  }
}

/** Identidad de nodo configurada localmente (provisioning/dev). */
export function getStoredSovereignUserId(): string {
  try {
    return window.localStorage.getItem(SOVEREIGN_USER_ID_KEY) || "";
  } catch {
    return "";
  }
}

export function setStoredSovereignUserId(userId: string): void {
  try {
    window.localStorage.setItem(SOVEREIGN_USER_ID_KEY, userId);
  } catch {
    // Almacenamiento no disponible.
  }
}

/**
 * Valida un evento postMessage de OAuth contra el origen EXACTO de la app.
 * Nunca se aceptan orígenes parcialmente coincidentes (`*.run.app`), evitando
 * el robo de tokens mediante cross-origin messaging.
 */
export function isTrustedOAuthEvent(event: MessageEvent): boolean {
  return event.origin === window.location.origin;
}

/** Obtiene una sesión emitida por el IDP de desarrollo; nunca fabrica tokens. */
export async function authFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const token = await ensureSessionToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers, credentials: "include" });
}

export async function ensureSessionToken(): Promise<string> {
  const existing = getSessionToken();
  if (existing) return existing;

  const response = await fetch(
    `/api/db?action=oauth-url&redirect_uri=${encodeURIComponent(`${window.location.origin}/api/db?action=oauth-callback`)}`,
  );
  const payload = (await response.json().catch(() => ({}))) as {
    url?: string;
    error?: string;
  };
  if (!response.ok || !payload.url) {
    const detail =
      payload.error || `El servidor rechazó la autorización OIDC (HTTP ${response.status}).`;
    throw new Error(
      `${detail} Inicia sesión con el proveedor OIDC configurado o habilita el flujo de desarrollo únicamente en un entorno local.`,
    );
  }

  return new Promise((resolve, reject) => {
    const popup = window.open(payload.url, "isabella-oidc", "width=520,height=720,resizable=yes");
    if (!popup) {
      reject(new Error("El navegador bloqueó la ventana de autorización OIDC."));
      return;
    }
    const timeout = window.setTimeout(() => {
      window.removeEventListener("message", handleMessage);
      reject(new Error("La autorización OIDC expiró o fue cancelada."));
    }, 120000);
    const handleMessage = (event: MessageEvent) => {
      if (!isTrustedOAuthEvent(event)) return;
      const token = typeof event.data?.token === "string" ? event.data.token : "";
      if (!token) return;
      window.clearTimeout(timeout);
      window.removeEventListener("message", handleMessage);
      popup.close();
      setSessionToken(token);
      if (typeof event.data?.userId === "string") setStoredSovereignUserId(event.data.userId);
      resolve(token);
    };
    window.addEventListener("message", handleMessage);
  });
}
