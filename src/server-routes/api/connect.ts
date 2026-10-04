import { json } from "@tanstack/react-start";
import { withSovereignAuth } from "@/lib/principal-context";
import { SecuritySystem } from "@/lib/security";
import { config } from "@/lib/config";
import {
  WEBHOOK_MAX_BYTES,
  resolveWebhookEventId,
  verifyWebhookSignature,
  webhookSecretFor,
} from "@/lib/connectors/webhook-verification";
import {
  createWebhookEventStore,
  hashWebhookPayload,
  type WebhookEventStore,
} from "@/lib/connectors/webhook-event-store";
import {
  beginAuthorization,
  isAuthorizationRequired,
  isConnectorProvider,
  providerRequest,
  type ConnectorProvider,
} from "@/lib/connectors/registry";

function providerFrom(request: Request): ConnectorProvider | null {
  const raw = new URL(request.url).searchParams.get("provider") ?? "";
  // Sanitización total — nunca confiar en query param sin filtrar
  const sanitized = SecuritySystem.sanitizePayload(raw);
  const provider = sanitized.flagged ? "" : sanitized.clean.slice(0, 64);
  return isConnectorProvider(provider) ? provider : null;
}

function protectedHandler(
  operation: (
    context: Parameters<Parameters<typeof withSovereignAuth>[2]>[0],
    request: Request,
    provider: ConnectorProvider,
  ) => Promise<Response>,
) {
  return withSovereignAuth("system", "execute", async (context, request) => {
    if (context.role === "Guest") {
      return json({ error: "AUTHENTICATION_REQUIRED" }, { status: 401 });
    }
    const provider = providerFrom(request);
    if (!provider) return json({ error: "UNSUPPORTED_CONNECTOR" }, { status: 400 });
    return operation(context, request, provider);
  });
}

export const start = protectedHandler(async (context, request, provider) => {
  try {
    const authorization = await beginAuthorization(provider, context, request);
    return json({ provider, url: authorization.url, expiresAt: authorization.expiresAt });
  } catch (error) {
    return json(
      { error: "CONNECT_AUTHORIZATION_UNAVAILABLE", retryable: isAuthorizationRequired(error) },
      { status: 503 },
    );
  }
});

export const status = protectedHandler(async (context, request, provider) => {
  try {
    const { response, token } = await providerRequest(provider, context);
    const data = await response.json().catch(() => null);
    return json(
      { provider, connected: response.ok, expiresAt: token.expiresAt, data },
      { status: response.ok ? 200 : 502 },
    );
  } catch (error) {
    return json(
      {
        provider,
        connected: false,
        error: isAuthorizationRequired(error) ? "AUTHORIZATION_REQUIRED" : "CONNECTOR_UNAVAILABLE",
      },
      { status: isAuthorizationRequired(error) ? 401 : 503 },
    );
  }
});

export interface WebhookOptions {
  /** Almacén de idempotencia inyectable (tests); por defecto, el autoritativo. */
  store?: WebhookEventStore | null;
  /** Entorno inyectable (tests); por defecto, config(). */
  env?: Record<string, string | undefined>;
}

export async function webhook(
  request: Request,
  provider: ConnectorProvider,
  options: WebhookOptions = {},
): Promise<Response> {
  const environment = options.env ?? (config() as unknown as Record<string, string | undefined>);

  // 1. Límite de tamaño ANTES de parsear (ISA-206).
  const rawBody = await request.text();
  const byteLength = Buffer.byteLength(rawBody, "utf8");
  if (byteLength > WEBHOOK_MAX_BYTES) {
    return json({ accepted: false, error: "WEBHOOK_PAYLOAD_TOO_LARGE" }, { status: 413 });
  }

  // 2. Identidad del evento, saneada (nunca se refleja el payload).
  const rawEventId = resolveWebhookEventId(request.headers);
  const sanitizedEventId = SecuritySystem.sanitizePayload(rawEventId);
  const eventId = sanitizedEventId.flagged ? "" : sanitizedEventId.clean.slice(0, 256);
  if (!eventId || sanitizedEventId.flagged) {
    return json({ accepted: false, error: "CONNECT_EVENT_ID_REQUIRED" }, { status: 400 });
  }

  // 3. Verificación de firma sobre los bytes exactos recibidos (ISA-199/ISA-205).
  //    Sin secreto configurado o sin esquema verificable: fail-closed.
  const verification = verifyWebhookSignature({
    provider,
    rawBody,
    byteLength,
    headers: request.headers,
    secret: webhookSecretFor(provider, environment),
  });
  if (!verification.ok) {
    const status =
      verification.code === "WEBHOOK_SECRET_NOT_CONFIGURED"
        ? 503
        : verification.code === "WEBHOOK_PAYLOAD_TOO_LARGE"
          ? 413
          : verification.code === "WEBHOOK_SIGNATURE_UNSUPPORTED"
            ? 501
            : 401;
    // Nunca se incluye la firma recibida ni el secreto en la respuesta (ISA-217).
    return json({ accepted: false, error: verification.code }, { status });
  }

  // 4. Idempotencia durable ANTES del ACK (ISA-200/ISA-210).
  const store = options.store !== undefined ? options.store : createWebhookEventStore(environment);
  if (!store) {
    return json(
      {
        accepted: false,
        error: "WEBHOOK_STORE_UNAVAILABLE",
        action: "Requiere almacén durable de eventos de webhook antes de aceptar.",
      },
      { status: 503 },
    );
  }

  // 5. Reclamo durable: el evento queda en la cola como `pending` y recién
  //    entonces se hace ACK. El trabajo aguas abajo corre fuera del request
  //    mediante processPendingWebhooks() (ISA-207) y nunca antes del ACK.
  const outcome = await store.claim({
    provider,
    eventId,
    payloadHash: hashWebhookPayload(rawBody),
  });

  if (outcome === "duplicate") {
    // Reentrega idempotente: se confirma sin reprocesar.
    return json({ accepted: true, duplicate: true, provider, eventId, governed: true });
  }

  return json({
    accepted: true,
    duplicate: false,
    provider,
    eventId,
    governed: true,
    queued: true,
    durable: store.durable,
  });
}
