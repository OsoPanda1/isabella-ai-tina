import { secrets } from "@/lib/secrets";
import { SecuritySystem } from "@/lib/security";
import type { IntelligenceProvider, IntelligenceRequest, IntelligenceResponse } from "./contracts";
import {
  BedrockTransport,
  BEDROCK_CONVERSE_SENTINEL,
  BEDROCK_REGION_SENTINEL,
} from "./transports/bedrock";
import { signRequest } from "./transports/aws-sigv4";

const SIGV4_SERVICE = "bedrock";
const REGION_PATTERN = /^[a-z0-9-]{2,32}$/;

/**
 * AWS Bedrock Converse provider.
 *
 * Data path: `BedrockTransport.buildKwargs` → strip dispatch sentinels →
 * SigV4 signing (`node:crypto`) → `SecuritySystem.fetchSafeUpstream` against the
 * fail-closed Bedrock egress host → `validateResponse` → `normalizeResponse`.
 *
 * Credentials come from `secrets` (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`,
 * optional `AWS_SESSION_TOKEN`); `invoke` fails closed when they are absent or
 * when the region is malformed. Registration into the intelligence router is a
 * separate governance step: reachable here does not imply authorized.
 */
export class BedrockProvider implements IntelligenceProvider {
  readonly providerId = "bedrock-converse";
  readonly modelId: string;
  readonly capabilities = new Set(["text"] as const);

  private readonly region: string;
  private readonly transport = new BedrockTransport();

  constructor(modelId: string, region: string) {
    this.modelId = modelId;
    this.region = region;
  }

  /** True only when both credential pairs exist and the region is well-formed. */
  async health(): Promise<boolean> {
    try {
      if (!REGION_PATTERN.test(this.region)) return false;
      const accessKeyId = secrets.getOptional("AWS_ACCESS_KEY_ID");
      const secretAccessKey = secrets.getOptional("AWS_SECRET_ACCESS_KEY");
      return Boolean(accessKeyId && secretAccessKey);
    } catch {
      return false;
    }
  }

  /** Call `Converse`, normalize the response and surface usage/tool/reasoning metadata. */
  async invoke(request: IntelligenceRequest): Promise<IntelligenceResponse> {
    const accessKeyId = secrets.getOptional("AWS_ACCESS_KEY_ID");
    const secretAccessKey = secrets.getOptional("AWS_SECRET_ACCESS_KEY");
    if (!accessKeyId || !secretAccessKey) throw new Error("bedrock_credentials_missing");
    if (!REGION_PATTERN.test(this.region)) throw new Error("bedrock_region_invalid");
    const sessionToken = secrets.getOptional("AWS_SESSION_TOKEN") ?? undefined;
    const started = performance.now();

    const kwargs = this.transport.buildKwargs(this.modelId, request.messages, null, {
      region: this.region,
      maxTokens: request.maxTokens,
      temperature: request.temperature,
    });
    if (kwargs[BEDROCK_CONVERSE_SENTINEL] !== true) throw new Error("bedrock_kwargs_invalid");
    const region = kwargs[BEDROCK_REGION_SENTINEL];
    if (typeof region !== "string" || !REGION_PATTERN.test(region)) {
      throw new Error("bedrock_region_invalid");
    }
    delete kwargs[BEDROCK_CONVERSE_SENTINEL];
    delete kwargs[BEDROCK_REGION_SENTINEL];

    const body = JSON.stringify(kwargs);
    const url = `https://bedrock-runtime.${region}.amazonaws.com/model/${encodeURIComponent(this.modelId)}/converse`;
    const { headers } = signRequest({
      method: "POST",
      url,
      headers: { "content-type": "application/json" },
      body,
      region,
      service: SIGV4_SERVICE,
      credentials: { accessKeyId, secretAccessKey, sessionToken },
    });

    const upstream = await SecuritySystem.fetchSafeUpstream(url, {
      method: "POST",
      headers,
      body,
    });
    if (!upstream.ok) throw new Error(`Bedrock upstream returned ${upstream.status}`);

    const payload: unknown = await upstream.json();
    if (!this.transport.validateResponse(payload)) throw new Error("bedrock_response_invalid");
    const normalized = this.transport.normalizeResponse(payload, kwargs);
    const content = normalized.content;
    const toolCalls = normalized.toolCalls;
    if ((!content || content.length === 0) && (!toolCalls || toolCalls.length === 0)) {
      throw new Error("bedrock_returned_no_content");
    }

    const cacheStats = this.transport.extractCacheStats(payload);
    const usage: NonNullable<IntelligenceResponse["usage"]> = {};
    if (normalized.usage) {
      usage.inputTokens = normalized.usage.promptTokens;
      usage.outputTokens = normalized.usage.completionTokens;
      usage.totalTokens = normalized.usage.totalTokens;
    }
    if (cacheStats) {
      usage.cachedTokens = cacheStats.cachedTokens;
      usage.creationTokens = cacheStats.creationTokens;
    }

    const response: IntelligenceResponse = {
      requestId: request.requestId,
      modelId: this.modelId,
      providerId: this.providerId,
      text: content ?? "",
      latencyMs: performance.now() - started,
      degraded: false,
      risk: "LOW",
      finishReason: normalized.finishReason,
    };
    if (toolCalls) response.toolCalls = toolCalls;
    if (normalized.reasoning !== null) response.reasoning = normalized.reasoning;
    if (Object.keys(usage).length > 0) response.usage = usage;
    return response;
  }
}
