import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

/**
 * CONTEXTO ÚNICO POR REQUEST (src/lib/request-context.ts)
 * -----------------------------------------------------------------
 * Propaga un contexto inmutable por request (traceId, correlationId,
 * tiempos, origen) mediante AsyncLocalStorage para observabilidad y
 * auditoría correlacionable. Creado en server.ts (correlación) antes
 * de cualquier lógica de handler.
 */

export interface RequestContextData {
  traceId: string;
  correlationId: string;
  requestId: string;
  startedAt: number;
  clientIp?: string;
  method?: string;
  path?: string;
  route?: string;
}

export const requestStore = new AsyncLocalStorage<RequestContextData>();

function genId(): string {
  return randomUUID().replace(/-/g, "");
}

export function createRequestContext(
  opts: Partial<Pick<RequestContextData, "clientIp" | "method" | "path" | "route">>,
): RequestContextData {
  const startedAt = Date.now();
  return {
    traceId: genId(),
    correlationId: genId(),
    requestId: genId(),
    startedAt,
    ...(opts.clientIp !== undefined ? { clientIp: opts.clientIp } : {}),
    ...(opts.method !== undefined ? { method: opts.method } : {}),
    ...(opts.path !== undefined ? { path: opts.path } : {}),
    ...(opts.route !== undefined ? { route: opts.route } : {}),
  };
}

export function withRequestContext<T>(data: RequestContextData, fn: () => T): T {
  return requestStore.run(data, fn);
}

export function getRequestContext(): RequestContextData | undefined {
  return requestStore.getStore();
}

export function getTraceId(): string {
  return getRequestContext()?.traceId ?? "";
}
