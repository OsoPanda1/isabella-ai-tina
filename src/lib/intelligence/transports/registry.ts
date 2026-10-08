import type { ProviderTransport } from "./base";
import type { TransportApiMode } from "./types";

export interface RemoteProviderEnv {
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_MODEL?: string;
  BEDROCK_ENABLED?: boolean;
  BEDROCK_MODEL?: string;
  BEDROCK_REGION?: string;
}

export interface RemoteProviderDescriptor {
  providerId: string;
  modelId: string;
}

const transports = new Map<TransportApiMode, ProviderTransport>();

/**
 * Select the remote providers that can be constructed from the declared
 * environment. Discovery is not authorization: each capability still has to
 * clear credential validation, model-registry approval and the runtime
 * production gate before any egress happens.
 */
export function selectRemoteProviders(env: RemoteProviderEnv): RemoteProviderDescriptor[] {
  const providers: RemoteProviderDescriptor[] = [];
  if (env.ANTHROPIC_API_KEY && env.ANTHROPIC_MODEL) {
    providers.push({ providerId: "anthropic-messages", modelId: env.ANTHROPIC_MODEL });
  }
  if (env.BEDROCK_ENABLED && env.BEDROCK_MODEL && env.BEDROCK_REGION) {
    providers.push({ providerId: "bedrock-converse", modelId: env.BEDROCK_MODEL });
  }
  return providers;
}

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
