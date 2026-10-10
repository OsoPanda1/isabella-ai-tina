/**
 * Chat-to-Skill Executor Bridge (src/lib/skills/chat-bridge.ts)
 * -----------------------------------------------------------------
 * Detecta invocaciones de habilidades soberanas (@skill:<nombre> o @<nombre>)
 * en el flujo de conversación de Isabella y las ejecuta a través del pipeline
 * endurecido runtime `runIsabellaSkill()`, asegurando:
 *  1. Autenticación explícita y contexto de identidad (actorId, tenantId, role).
 *  2. Evaluación de políticas de gobernanza CROWN (Zero Trust Gate).
 *  3. Ejecución del runtime soberano aislado.
 *  4. Registro y sellado de evidencia criptográfica inmutable en BookPI.
 *  5. Capacidad de streaming SSE compatible con OpenAI/Gemini para el chat stream.
 */

import { scanOutput, safeOutputOrBlock } from "@/lib/security/output-gate";
import {
  detectSkillInvocation,
  processSkillInvocation,
  type SkillInvocation,
  type ProcessSkillResult,
} from "./skill-bridge";

export { detectSkillInvocation, type SkillInvocation };

export interface BridgeContext {
  correlationId: string;
  traceId: string;
  userId: string;
  tenantId: string;
  role: string;
  scope?: string;
  ip?: string;
  userAgent?: string;
  authenticated?: boolean;
}

export interface ChatSkillExecutionResult {
  success: boolean;
  content: string;
  skillId: string;
  decisionId?: string | null;
  traceId?: string;
  code?: string;
  error?: string;
  bookpiLogged: boolean;
  rawResult?: unknown;
}

/**
 * Ejecuta una invocación de skill dentro del contexto del chat gateway,
 * canalizando toda la operación a través del runtime canónico `processSkillInvocation()`.
 */
export async function executeChatSkillBridge(
  invocation: SkillInvocation,
  context: BridgeContext,
): Promise<ChatSkillExecutionResult> {
  const result: ProcessSkillResult = await processSkillInvocation({
    text: `@skill:${invocation.canonicalName} ${invocation.rawInput}`,
    actorId: context.userId,
    tenantId: context.tenantId,
    role: context.role,
    authenticated: context.authenticated ?? context.role !== "Guest",
    ipAddress: context.ip,
    userAgent: context.userAgent,
    requestId: context.correlationId,
    traceId: context.traceId,
  });

  const gatedContent = safeOutputOrBlock(result.content, "skill-output");

  return {
    success: result.success,
    content: gatedContent,
    skillId: result.skillId || invocation.canonicalName,
    decisionId: result.decisionId,
    traceId: result.traceId,
    code: result.code,
    error: result.error,
    bookpiLogged: result.bookpiLogged,
    rawResult: result.rawResult,
  };
}

/**
 * Transforma un resultado de skill ejecutado en una respuesta de streaming SSE compatible
 * con el formato estándar de OpenAI / Gemini usado por el frontend de chat.
 */
export function streamChatSkillAsSse(result: ChatSkillExecutionResult, headers: Headers): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      try {
        // Marco 1: metadatos de auditoría y proveedor
        const initMetadata = {
          provider: "isabella-skill-runtime",
          skillId: result.skillId,
          decisionId: result.decisionId ?? null,
          traceId: result.traceId ?? null,
          bookpiLogged: result.bookpiLogged,
        };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(initMetadata)}\n\n`));

        // Marco 2: contenido incremental (delta), SIEMPRE tras output gate.
        // (Antes se enrutaba result.content crudo: el gate quedaba anulado.)
        const gate = scanOutput(result.content, "skill-output");
        const gatedContent = gate.allowed
          ? gate.text
          : safeOutputOrBlock(result.content, "skill-output");
        const chunk = {
          choices: [
            {
              delta: {
                content: gatedContent,
              },
            },
          ],
        };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));

        // Marco final: [DONE]
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });

  return new Response(stream, { status: 200, headers });
}

/**
 * Utilidad unificada de enlace: analiza el mensaje del chat stream, detecta invocaciones
 * a `@skill`, ejecuta `runIsabellaSkill()` con CROWN y BookPI, y produce directamente
 * la respuesta SSE del stream si corresponde. Si no es un skill, retorna null.
 */
export async function bindChatSkillStream(
  message: string,
  context: BridgeContext,
  sseHeadersFactory: (provider: string, model: string) => Headers,
): Promise<{
  handled: boolean;
  response?: Response;
  error?: { code: string; message: string; status: number };
}> {
  const invocation = detectSkillInvocation(message);
  if (!invocation) {
    return { handled: false };
  }

  const result = await executeChatSkillBridge(invocation, context);

  if (!result.success) {
    if (result.code === "CROWN_POLICY_DENY" || result.code === "IDENTITY_REQUIRED") {
      return {
        handled: true,
        error: {
          code: result.code,
          message: result.error || "Acceso denegado por política de gobernanza CROWN.",
          status: 403,
        },
      };
    }
  }

  const headers = sseHeadersFactory("isabella-skill-runtime", invocation.canonicalName);
  const response = streamChatSkillAsSse(result, headers);
  return { handled: true, response };
}
