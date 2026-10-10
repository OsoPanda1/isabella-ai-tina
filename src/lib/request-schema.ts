import { z } from "zod";
import { getInputLimits } from "./input-limits";

/**
 * CONTRATO UNIVERSAL DE REQUEST (src/lib/request-schema.ts)
 * -----------------------------------------------------------------
 * Esquema canónico para las acciones de la API. Todo endpoint que
 * reciba acciones estructuradas debe validar contra estos esquemas
 * (Zod) en la capa de transporte antes de cualquier lógica.
 */

const limits = getInputLimits();

export const requestHeaderSchema = z.object({
  authorization: z.string().optional(),
  "x-tenant-id": z.string().optional(),
  "x-correlation-id": z.string().optional(),
  "x-request-id": z.string().optional(),
  "x-device-id": z.string().optional(),
  "x-idempotency-key": z.string().max(128).optional(),
});

export type RequestHeaders = z.infer<typeof requestHeaderSchema>;

export const messageSchema = z.object({
  role: z.enum(["system", "user", "assistant", "isabella", "tool"]),
  content: z.string().max(64 * 1024),
  ts: z.string().optional(),
});

export const inferenceRequestSchema = z.object({
  input: z
    .string()
    .trim()
    .min(1)
    .max(32 * 1024),
  attachments: z.array(z.string()).max(8).optional(),
  preset: z.string().max(64).optional(),
  messages: z.array(messageSchema).max(limits.maxMessages).optional(),
  tools: z.array(z.string()).max(limits.maxToolsPerRequest).optional(),
});

export type InferenceRequest = z.infer<typeof inferenceRequestSchema>;

export const dbActionSchema = z.object({
  action: z.enum([
    "session",
    "ledger",
    "verify-ledger",
    "verify-audit-chain",
    "test",
    "audit",
    "heads",
    "provision-owner",
    "dev-session",
    "ledger-add",
    "ledger-refund",
    "execute-tool",
    "memory.create",
    "memory.list",
    "memory.delete",
    "approvals.list",
    "approvals.approve",
    "approvals.reject",
    "oauth-url",
    "oauth-provider",
    "oauth-callback",
    "oauth-authorize-action",
  ]),
  data: z.unknown().optional(),
});

export type DbAction = z.infer<typeof dbActionSchema>;
