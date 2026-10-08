/**
 * ================================================================
 * ISABELLA VILLASEÑOR AI — AGENT ORCHESTRATOR (Module 1)
 * Central agent loop: input → context → inference → tools → response
 * Replaces Hermes AIAgent with sovereign architecture.
 * ================================================================
 */
import { randomUUID } from "node:crypto";
import { buildSystemPrompt } from "./prompt-builder";
import { resolveRuntimeProvider, type RuntimeProvider } from "../runtime/provider-registry";
import { classifyRisk, type RiskClassification } from "../../governance/safety";
import { checkConsent, type ConsentDecision } from "../../governance/consent";
import { resolveToolCall, type ToolDispatchResult } from "../runtime/tool-dispatch";
import { compressContext } from "../context/context-compressor";
import { auditReceipt, type AuditReceipt } from "../../governance/audit-receipt";

/* =========================================================================
   TYPES
   ========================================================================= */

export interface AgentMessage {
  readonly role: "user" | "assistant" | "system" | "tool";
  readonly content: string;
  readonly timestamp: string;
  readonly toolCallId?: string;
}

export interface AgentSession {
  readonly sessionId: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly messages: AgentMessage[];
  readonly startedAt: string;
  readonly lastActivityAt: string;
}

export interface AgentRunRequest {
  readonly tenantId: string;
  readonly userId: string;
  readonly sessionId?: string;
  readonly input: string;
  readonly channel: "cli" | "api" | "webhook" | "voice" | "messaging";
  readonly capabilities?: string[];
}

export interface AgentRunResult {
  readonly sessionId: string;
  readonly response: string;
  readonly riskClassification: RiskClassification;
  readonly consentDecision: ConsentDecision;
  readonly toolCalls: ToolDispatchResult[];
  readonly auditReceipts: AuditReceipt[];
  readonly latencyMs: number;
  readonly tokensUsed: number;
  readonly provider: string;
  readonly model: string;
  readonly truncated: boolean;
}

/* =========================================================================
   SESSION STORE (SQLite-backed)
   ========================================================================= */

const sessions = new Map<string, AgentSession>();
const MAX_SESSIONS = 500;
const MAX_MESSAGES_PER_SESSION = 200;

function getOrCreateSession(req: AgentRunRequest): AgentSession {
  if (req.sessionId) {
    const existing = sessions.get(req.sessionId);
    if (existing) return existing;
  }
  const session: AgentSession = {
    sessionId: randomUUID(),
    tenantId: req.tenantId,
    userId: req.userId,
    messages: [],
    startedAt: new Date().toISOString(),
    lastActivityAt: new Date().toISOString(),
  };
  sessions.set(session.sessionId, session);
  if (sessions.size > MAX_SESSIONS) {
    const oldest = sessions.keys().next().value;
    if (oldest) sessions.delete(oldest);
  }
  return session;
}

function appendMessage(session: AgentSession, msg: AgentMessage): void {
  session.messages.push(msg);
  if (session.messages.length > MAX_MESSAGES_PER_SESSION) {
    session.messages.splice(0, session.messages.length - MAX_MESSAGES_PER_SESSION);
  }
  (session as { lastActivityAt: string }).lastActivityAt = new Date().toISOString();
}

/* =========================================================================
   ORCHESTRATOR — CORE AGENT LOOP
   ========================================================================= */

const MAX_TOOL_ROUNDS = 5;
const MAX_INPUT_LENGTH = 16_000;

export async function runAgent(req: AgentRunRequest): Promise<AgentRunResult> {
  const t0 = Date.now();
  const session = getOrCreateSession(req);

  const input = req.input.slice(0, MAX_INPUT_LENGTH);
  appendMessage(session, {
    role: "user",
    content: input,
    timestamp: new Date().toISOString(),
  });

  const riskClassification = classifyRisk(input, req.channel);
  const consentDecision = checkConsent(input, riskClassification, req.capabilities || []);

  const provider = resolveRuntimeProvider();
  const toolCalls: ToolDispatchResult[] = [];
  const auditReceipts: AuditReceipt[] = [];

  const auditR = auditReceipt({
    action: "agent.run",
    actor: req.userId,
    tenantId: req.tenantId,
    sessionId: session.sessionId,
    riskLevel: riskClassification.level,
    consentRequired: consentDecision.requiresExplicitConsent,
    consentGranted: consentDecision.granted,
    inputLength: input.length,
  });
  auditReceipts.push(auditR);

  if (!consentDecision.granted) {
    const denialResponse = consentDecision.reason || "Action blocked by governance policy.";
    appendMessage(session, {
      role: "assistant",
      content: denialResponse,
      timestamp: new Date().toISOString(),
    });
    return buildResult(
      session,
      denialResponse,
      provider,
      riskClassification,
      consentDecision,
      toolCalls,
      auditReceipts,
      t0,
      0,
      false,
    );
  }

  const conversationMessages = session.messages.map((m) => ({ role: m.role, content: m.content }));
  let currentMessages = conversationMessages;

  if (provider.contextWindowLimit > 0) {
    const compressed = compressContext(currentMessages, provider.contextWindowLimit);
    currentMessages = compressed.messages;
  }

  let finalResponse = "";
  let totalTokens = 0;
  let truncated = false;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const inferenceResult = await provider.infer({
      systemPrompt: buildSystemPrompt(req.tenantId),
      messages: currentMessages,
      tools: riskClassification.allowedTools,
    });

    totalTokens += inferenceResult.tokensUsed;

    if (inferenceResult.toolCalls && inferenceResult.toolCalls.length > 0) {
      for (const tc of inferenceResult.toolCalls) {
        const toolResult = await resolveToolCall(tc, req.userId, req.tenantId);
        toolCalls.push(toolResult);

        const toolReceipt = auditReceipt({
          action: `tool.${tc.name}`,
          actor: req.userId,
          tenantId: req.tenantId,
          sessionId: session.sessionId,
          riskLevel: riskClassification.level,
          toolName: tc.name,
          success: toolResult.success,
          executionMs: toolResult.executionMs,
        });
        auditReceipts.push(toolReceipt);

        currentMessages.push({
          role: "tool" as const,
          content: JSON.stringify(toolResult.result),
        });
      }
      continue;
    }

    finalResponse = inferenceResult.text;
    break;
  }

  if (!finalResponse) {
    finalResponse =
      "El ciclo de herramientas agotó el límite de iteraciones. Intenta con una consulta más específica.";
    truncated = true;
  }

  appendMessage(session, {
    role: "assistant",
    content: finalResponse,
    timestamp: new Date().toISOString(),
  });

  return buildResult(
    session,
    finalResponse,
    provider,
    riskClassification,
    consentDecision,
    toolCalls,
    auditReceipts,
    t0,
    totalTokens,
    truncated,
  );
}

/* =========================================================================
   HELPERS
   ========================================================================= */

function buildResult(
  session: AgentSession,
  response: string,
  provider: RuntimeProvider,
  risk: RiskClassification,
  consent: ConsentDecision,
  toolCalls: ToolDispatchResult[],
  receipts: AuditReceipt[],
  t0: number,
  tokens: number,
  truncated: boolean,
): AgentRunResult {
  return {
    sessionId: session.sessionId,
    response,
    riskClassification: risk,
    consentDecision: consent,
    toolCalls,
    auditReceipts: receipts,
    latencyMs: Date.now() - t0,
    tokensUsed: tokens,
    provider: provider.name,
    model: provider.model,
    truncated,
  };
}

export function getSession(sessionId: string): AgentSession | undefined {
  return sessions.get(sessionId);
}

export function getSessionHistory(sessionId: string): AgentMessage[] {
  return sessions.get(sessionId)?.messages || [];
}

export function deleteSession(sessionId: string): boolean {
  return sessions.delete(sessionId);
}

export function listSessions(tenantId: string): AgentSession[] {
  return Array.from(sessions.values()).filter((s) => s.tenantId === tenantId);
}
