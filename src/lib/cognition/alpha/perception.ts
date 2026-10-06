/**
 * ================================================================
 * ISABELLA VILLASEÑOR AI — ALPHA / PERCEPTION
 * Normaliza texto, audio, eventos y señales contextuales.
 * Produce una representación estructurada de la intención.
 * Flujo: raw input → normalize → classify → extract → PerceptionResult
 * ================================================================
 */

import { randomUUID } from "node:crypto";

import type { DataClassification, RiskLevel } from "../contracts";

/* =========================================================================
   TYPES
   ========================================================================= */

export type InputModality = "text" | "audio" | "event" | "signal" | "multimodal";

export type IntentCategory =
  | "question"
  | "command"
  | "request"
  | "creation"
  | "analysis"
  | "navigation"
  | "governance"
  | "monetization"
  | "system";

export type UrgencyLevel = "none" | "low" | "medium" | "high" | "critical";

export type Sentiment = "positive" | "neutral" | "negative" | "mixed";

export interface PerceptionResult {
  id: string;
  rawInput: string;
  modality: InputModality;
  language: string;
  intent: IntentCategory;
  intentConfidence: number;
  entities: Entity[];
  urgency: UrgencyLevel;
  sentiment: Sentiment;
  preliminaryRisk: RiskLevel;
  suggestedClassification: DataClassification;
  normalizedInput: string;
  extractedFeatures: string[];
  timestamp: string;
}

export interface Entity {
  type: string;
  value: string;
  confidence: number;
  start: number;
  end: number;
}

/* =========================================================================
   PERCEPTION ENGINE
   ========================================================================= */

export class PerceptionEngine {
  /**
   * Process raw input and produce a structured perception.
   */
  async process(input: string, modality: InputModality = "text"): Promise<PerceptionResult> {
    const normalized = this.normalize(input);
    const language = this.detectLanguage(normalized);
    const intent = this.classifyIntent(normalized);
    const entities = this.extractEntities(normalized);
    const urgency = this.assessUrgency(normalized, entities);
    const sentiment = this.analyzeSentiment(normalized);
    const risk = this.preliminaryRisk(normalized, intent, entities);
    const classification = this.suggestClassification(risk, intent);
    const features = this.extractFeatures(normalized, entities);

    return {
      id: randomUUID(),
      rawInput: input,
      modality,
      language,
      intent: intent.category,
      intentConfidence: intent.confidence,
      entities,
      urgency,
      sentiment,
      preliminaryRisk: risk,
      suggestedClassification: classification,
      normalizedInput: normalized,
      extractedFeatures: features,
      timestamp: new Date().toISOString(),
    };
  }

  /* --- Normalization --- */

  private normalize(input: string): string {
    return input
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .replace(/\s+/g, " ");
  }

  /* --- Language Detection --- */

  private detectLanguage(input: string): string {
    const spanishPatterns =
      /\b(el|la|los|las|un|una|que|como|para|por|con|este|esta|puedo|hacer|quiero|necesito)\b/gi;
    const englishPatterns =
      /\b(the|a|an|is|are|was|can|could|should|would|need|want|make|do|how|what|where|when)\b/gi;

    const spanishMatches = (input.match(spanishPatterns) ?? []).length;
    const englishMatches = (input.match(englishPatterns) ?? []).length;

    if (spanishMatches > englishMatches) return "es";
    if (englishMatches > spanishMatches) return "en";
    return "und";
  }

  /* --- Intent Classification --- */

  private classifyIntent(input: string): {
    category: IntentCategory;
    confidence: number;
  } {
    const patterns: Array<{
      regex: RegExp;
      intent: IntentCategory;
      weight: number;
    }> = [
      {
        regex: /\b(que|que|como|donde|cuando|quien|por que|cual)\b/i,
        intent: "question",
        weight: 1.0,
      },
      {
        regex: /\b(haz|ejecuta|corre|inicia|detiene|envia|guarda|elimina|crea)\b/i,
        intent: "command",
        weight: 0.95,
      },
      {
        regex: /\b(puedes|podrias|quiero|necesito|me gustaria|favor de)\b/i,
        intent: "request",
        weight: 0.9,
      },
      {
        regex: /\b(crear|generar|construir|desarrollar|disenar|escribir)\b/i,
        intent: "creation",
        weight: 0.9,
      },
      {
        regex: /\b(analizar|evaluar|revisar|examinar|comparar|medir)\b/i,
        intent: "analysis",
        weight: 0.9,
      },
      {
        regex: /\b(abre|navega|muestra|enseña|busca|encuentra)\b/i,
        intent: "navigation",
        weight: 0.85,
      },
      {
        regex: /\b(politica|permiso|autorizacion|auditoria|seguridad)\b/i,
        intent: "governance",
        weight: 0.95,
      },
      {
        regex: /\b(precio|costo|pago|venta|ingreso|monetizar)\b/i,
        intent: "monetization",
        weight: 0.9,
      },
      {
        regex: /\b(estado|status|sistema|configuracion|ayuda)\b/i,
        intent: "system",
        weight: 0.85,
      },
    ];

    let bestMatch: { category: IntentCategory; confidence: number } = {
      category: "question",
      confidence: 0.5,
    };

    for (const pattern of patterns) {
      const matches = input.match(pattern.regex);
      if (matches && matches.length > 0) {
        const confidence = Math.min(0.98, pattern.weight * (1 + matches.length * 0.02));
        if (confidence > bestMatch.confidence) {
          bestMatch = { category: pattern.intent, confidence };
        }
      }
    }

    return bestMatch;
  }

  /* --- Entity Extraction --- */

  private extractEntities(input: string): Entity[] {
    const entities: Entity[] = [];
    const patterns: Array<{ type: string; regex: RegExp }> = [
      {
        type: "date",
        regex: /\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\b/g,
      },
      {
        type: "email",
        regex: /\b([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/g,
      },
      { type: "url", regex: /\b(https?:\/\/[^\s]+)\b/g },
      { type: "number", regex: /\b(\d+(?:\.\d+)?)\b/g },
      {
        type: "territory",
        regex: /\b(Real del Monte|Mineral del Monte|Hidalgo|TAMV)\b/gi,
      },
    ];

    for (const pattern of patterns) {
      let match: RegExpExecArray | null;
      while ((match = pattern.regex.exec(input)) !== null) {
        entities.push({
          type: pattern.type,
          value: match[1] ?? match[0],
          confidence: 0.85,
          start: match.index,
          end: match.index + match[0].length,
        });
      }
    }

    return entities;
  }

  /* --- Urgency Assessment --- */

  private assessUrgency(input: string, entities: Entity[]): UrgencyLevel {
    const criticalPatterns = /\b(urgente|emergencia|critico|ahora|inmediato|danger|emergency)\b/i;
    const highPatterns = /\b(importante|prioridad|pronto|rapido|asap|temprano)\b/i;
    const mediumPatterns = /\bCuando puedas|en breve|pronto|usual\b/i;

    if (criticalPatterns.test(input)) return "critical";
    if (highPatterns.test(input)) return "high";
    if (mediumPatterns.test(input)) return "medium";
    if (entities.some((e) => e.type === "date")) return "low";
    return "none";
  }

  /* --- Sentiment Analysis --- */

  private analyzeSentiment(input: string): Sentiment {
    const positivePatterns =
      /\b(excelente|genial|perfecto|gracias|bien|me gusta|me encanta|increible)\b/i;
    const negativePatterns = /\b(malo|terrible|error|fallo|problema|no funciona|furioso|odio)\b/i;

    const positive = positivePatterns.test(input);
    const negative = negativePatterns.test(input);

    if (positive && negative) return "mixed";
    if (positive) return "positive";
    if (negative) return "negative";
    return "neutral";
  }

  /* --- Preliminary Risk --- */

  private preliminaryRisk(
    input: string,
    intent: { category: IntentCategory },
    entities: Entity[],
  ): RiskLevel {
    const hasSensitiveEntities = entities.some((e) => e.type === "email" || e.type === "url");
    const isGovernanceIntent = intent.category === "governance";
    const isSystemIntent = intent.category === "system";
    const hasCriticalKeywords = /\b(eliminar|borrar|revoke|delete|admin|root)\b/i.test(input);

    if (hasCriticalKeywords && isGovernanceIntent) return "R4_critical";
    if (hasCriticalKeywords) return "R3_high";
    if (isGovernanceIntent || isSystemIntent) return "R2_moderate";
    if (hasSensitiveEntities) return "R2_moderate";
    return "R1_low";
  }

  /* --- Classification Suggestion --- */

  private suggestClassification(
    risk: RiskLevel,
    intent: { category: IntentCategory },
  ): DataClassification {
    if (risk === "R4_critical") return "critical";
    if (risk === "R3_high") return "restricted";
    if (risk === "R2_moderate") return "sensitive";
    if (intent.category === "governance") return "internal";
    return "public";
  }

  /* --- Feature Extraction --- */

  private extractFeatures(input: string, entities: Entity[]): string[] {
    const features: string[] = [];

    if (entities.length > 0) features.push("has_entities");
    if (input.length > 500) features.push("long_input");
    if (input.length < 20) features.push("short_input");
    if (/\bhttps?:\/\/\b/.test(input)) features.push("contains_url");
    if (/\b\d+\b/.test(input)) features.push("contains_numbers");

    return features;
  }
}

export const perceptionEngine = new PerceptionEngine();
