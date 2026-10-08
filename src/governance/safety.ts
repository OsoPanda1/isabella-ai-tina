/**
 * ================================================================
 * ISABELLA VILLASEÑOR AI — SAFETY CLASSIFIER (Module 10)
 * Risk classification for every action before execution.
 * ================================================================
 */

import type { ConsentScope } from "./consent";

export interface RiskClassification {
  readonly level: "low" | "medium" | "high";
  readonly category: string;
  readonly reason: string;
  readonly allowedTools: string[];
  readonly scopes: ConsentScope[];
  readonly requiresApproval: boolean;
  readonly classification: string;
}

const HIGH_RISK_PATTERNS = [
  /\b(delete|borrar|remover|destroy|eliminar)\b/i,
  /\b(pay|pagar|transfer|transferir|enviar dinero|withdraw|retirar)\b/i,
  /\b(password|contraseña|secret|secrettoken|api.?key|credential)\b/i,
  /\b(admin|root|sudo|elevat|escalat)\b/i,
  /\b(deploy|desplegar|publish|publicar|release)\b/i,
  /\b(share|compartir|export|exportar|send to|enviar a)\b.*\b(extern|third|tercer|public|publico)\b/i,
];

const MEDIUM_RISK_PATTERNS = [
  /\b(update|actualizar|modify|modificar|change|cambiar)\b/i,
  /\b(create|crear|add|agregar|new|nuevo)\b/i,
  /\b(file|archivo|document|documento)\b/i,
  /\b(memory|memoria|save|guardar|persist|persistir)\b/i,
  /\b(webhook|cron|schedule|programar|automatiz)\b/i,
];

export function classifyRisk(input: string, _channel: string): RiskClassification {
  for (const pattern of HIGH_RISK_PATTERNS) {
    if (pattern.test(input)) {
      return {
        level: "high",
        category: "destructive-sensitive",
        reason: `Input matches high-risk pattern: ${pattern.source}`,
        allowedTools: ["argus_security_audit"],
        scopes: ["all"],
        requiresApproval: true,
        classification: "HIGH_RISK",
      };
    }
  }

  for (const pattern of MEDIUM_RISK_PATTERNS) {
    if (pattern.test(input)) {
      return {
        level: "medium",
        category: "data-modification",
        reason: `Input matches medium-risk pattern: ${pattern.source}`,
        allowedTools: [
          "rdm_territory_query",
          "argus_security_audit",
          "crown_cognitive_arbitrate",
          "sovereign_ledger_commit",
        ],
        scopes: ["data"],
        requiresApproval: false,
        classification: "MEDIUM_RISK",
      };
    }
  }

  return {
    level: "low",
    category: "read-only",
    reason: "Input is a read-only or informational query.",
    allowedTools: [
      "rdm_territory_query",
      "argus_security_audit",
      "crown_cognitive_arbitrate",
      "sovereign_ledger_commit",
      "isabella_synthesize_voice",
    ],
    scopes: [],
    requiresApproval: false,
    classification: "LOW_RISK",
  };
}
