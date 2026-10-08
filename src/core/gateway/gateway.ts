/**
 * ================================================================
 * ISABELLA VILLASEÑOR AI — MULTI-CHANNEL GATEWAY (Module 8)
 * Adapts external platform events to unified MessageEvents.
 * ================================================================
 */
import type { AgentRunRequest, AgentRunResult } from "../orchestrator/orchestrator";
import { runAgent } from "../orchestrator/orchestrator";

export type ChannelType = "cli" | "api" | "webhook" | "voice" | "messaging";

export interface MessageEvent {
  readonly channel: ChannelType;
  readonly tenantId: string;
  readonly userId: string;
  readonly sessionId?: string;
  readonly content: string;
  readonly rawPayload?: Record<string, unknown>;
  readonly timestamp: string;
}

export interface GatewayAdapter {
  readonly name: string;
  readonly channel: ChannelType;
  authorize(event: MessageEvent): Promise<{ authorized: boolean; reason?: string }>;
  transform(event: MessageEvent): Promise<AgentRunRequest>;
  deliver(result: AgentRunResult, event: MessageEvent): Promise<void>;
}

/* =========================================================================
   BUILT-IN ADAPTERS
   ========================================================================= */

class ApiAdapter implements GatewayAdapter {
  readonly name = "api-adapter";
  readonly channel: ChannelType = "api";

  async authorize(event: MessageEvent): Promise<{ authorized: boolean; reason?: string }> {
    return { authorized: !!event.userId && !!event.tenantId };
  }

  async transform(event: MessageEvent): Promise<AgentRunRequest> {
    return {
      tenantId: event.tenantId,
      userId: event.userId,
      sessionId: event.sessionId,
      input: event.content,
      channel: "api",
    };
  }

  async deliver(_result: AgentRunResult): Promise<void> {
    /* API responses are returned directly by the HTTP layer */
  }
}

class WebhookAdapter implements GatewayAdapter {
  readonly name = "webhook-adapter";
  readonly channel: ChannelType = "webhook";

  async authorize(event: MessageEvent): Promise<{ authorized: boolean; reason?: string }> {
    const secret = process.env.ISABELLA_WEBHOOK_SECRET;
    if (!secret) return { authorized: true };
    const signature = event.rawPayload?.["x-webhook-signature"];
    if (signature !== secret) return { authorized: false, reason: "Invalid webhook signature" };
    return { authorized: true };
  }

  async transform(event: MessageEvent): Promise<AgentRunRequest> {
    return {
      tenantId: event.tenantId,
      userId: event.userId || "webhook-system",
      input: event.content,
      channel: "webhook",
    };
  }

  async deliver(_result: AgentRunResult): Promise<void> {
    /* Webhook responses are fire-and-forget or queued */
  }
}

class VoiceAdapter implements GatewayAdapter {
  readonly name = "voice-adapter";
  readonly channel: ChannelType = "voice";

  async authorize(event: MessageEvent): Promise<{ authorized: boolean; reason?: string }> {
    return { authorized: !!event.userId };
  }

  async transform(event: MessageEvent): Promise<AgentRunRequest> {
    return {
      tenantId: event.tenantId,
      userId: event.userId,
      sessionId: event.sessionId,
      input: event.content,
      channel: "voice",
    };
  }

  async deliver(_result: AgentRunResult): Promise<void> {
    /* Voice responses are handled by TTS pipeline */
  }
}

/* =========================================================================
   GATEWAY
   ========================================================================= */

const adapters = new Map<ChannelType, GatewayAdapter>();

function registerBuiltinAdapters(): void {
  adapters.set("api", new ApiAdapter());
  adapters.set("webhook", new WebhookAdapter());
  adapters.set("voice", new VoiceAdapter());
}

registerBuiltinAdapters();

export function registerAdapter(adapter: GatewayAdapter): void {
  adapters.set(adapter.channel, adapter);
}

export function getAdapter(channel: ChannelType): GatewayAdapter | undefined {
  return adapters.get(channel);
}

export async function processMessageEvent(
  event: MessageEvent,
): Promise<AgentRunResult | { error: string }> {
  const adapter = adapters.get(event.channel);
  if (!adapter) return { error: `No adapter registered for channel '${event.channel}'.` };

  const authResult = await adapter.authorize(event);
  if (!authResult.authorized) return { error: authResult.reason || "Unauthorized." };

  const agentRequest = await adapter.transform(event);
  const result = await runAgent(agentRequest);
  await adapter.deliver(result, event);
  return result;
}
