import type { ProviderTransport } from "./base";
import type { TransportApiMode } from "./types";

const transports = new Map<TransportApiMode, ProviderTransport>();

/** Bind a transport to its `apiMode`. Replaces an existing binding for that mode. */
export function registerTransport(transport: ProviderTransport): void {
  transports.set(transport.apiMode, transport);
}

/** Look up the transport for an `apiMode`, or `undefined` if none is registered. */
export function getTransport(mode: TransportApiMode): ProviderTransport | undefined {
  return transports.get(mode);
}

/** All registered modes, in registration order. */
export function listTransportModes(): TransportApiMode[] {
  return [...transports.keys()];
}

/**
 * Resolve a mode or fail closed.
 *
 * Registration is not authorization: callers still gate on credentials and
 * model registry approval before issuing a call.
 */
export function requireTransport(mode: TransportApiMode): ProviderTransport {
  const transport = transports.get(mode);
  if (!transport) throw new Error(`intelligence_transport_unavailable:${mode}`);
  return transport;
}
