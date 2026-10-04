export type MetricKind = "request" | "inference" | "policy" | "security" | "error";
export interface OTelEvent {
  traceId: string;
  kind: MetricKind;
  name: string;
  durationMs?: number;
  status: "ok" | "error" | "denied" | "degraded";
  attributes: Record<string, string | number | boolean>;
  timestamp: string;
}
const ALLOWED_KEYS = new Set([
  "route",
  "method",
  "runtime",
  "model",
  "locale",
  "decision",
  "error_code",
  "tenant_class",
]);
const MAX_ATTR_VALUE = 64;
function bucket(value: string | number | boolean): string | number | boolean {
  if (typeof value !== "string") return value;
  if (value.length <= MAX_ATTR_VALUE) return value;
  // Keep telemetry synchronous and browser-safe; never load node:crypto in the client.
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${value.slice(0, 8)}…${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
export function createTraceId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID().replaceAll("-", "");
  if (globalThis.crypto?.getRandomValues) {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  throw new Error("Cryptographically secure random source unavailable");
}
export function normalizeAttributes(
  input: Record<string, string | number | boolean>,
): Record<string, string | number | boolean> {
  return Object.fromEntries(
    Object.entries(input)
      .filter(([key]) => ALLOWED_KEYS.has(key))
      .map(([key, value]) => [key, bucket(value)]),
  );
}
export function createOTelEvent(
  input: Omit<OTelEvent, "timestamp" | "attributes"> & {
    attributes?: Record<string, string | number | boolean>;
  },
): OTelEvent {
  return {
    ...input,
    traceId: input.traceId || createTraceId(),
    attributes: normalizeAttributes(input.attributes ?? {}),
    timestamp: new Date().toISOString(),
  };
}
export function toOTelLog(event: OTelEvent): string {
  return JSON.stringify({
    time: event.timestamp,
    trace_id: event.traceId,
    event: event.name,
    kind: event.kind,
    duration_ms: event.durationMs,
    status: event.status,
    attributes: event.attributes,
  });
}
