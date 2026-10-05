/**
 * ============================================================================
 * ISABELLA VILLASEÑOR AI
 * CANONICAL DOMAIN CONTRACTS · v1
 * ============================================================================
 *
 * Contrato de tipos para UI, gateway y eventos internos.
 *
 * Principios:
 * - Ningún valor externo se considera confiable por el solo hecho de tiparse.
 * - Las validaciones de rango se realizan en runtime con Zod/Valibot/handlers.
 * - No se registran prompts, respuestas, memoria, audio, documentos ni PII
 *   dentro de telemetría o publicidad.
 * - La publicidad se modela como un elemento independiente del chat.
 * - El diseño visual no pertenece al dominio: colores y clases viven en UI/CSS.
 * ============================================================================
 */

export * from "./contracts/isabella";

/* ============================================================================
   01. PRIMITIVOS DE DOMINIO
   ============================================================================ */

export type ISODateTime = string;
export type UUID = string;
export type SHA256Digest = string;
export type URLString = string;
export type Milliseconds = number;
export type Percentage = number;
export type Ratio = number;

export type Nullable<T> = T | null;

export type ReadonlyRecord<TValue> = Readonly<Record<string, TValue>>;

/**
 * Contrato de resultado para operaciones asíncronas de dominio.
 * Evita lanzar errores no tratados para condiciones de negocio previsibles.
 */
export type Result<TData, TCode extends string = string> =
  | {
      ok: true;
      data: TData;
      error?: never;
    }
  | {
      ok: false;
      data?: never;
      error: DomainError<TCode>;
    };

export interface DomainError<TCode extends string = string> {
  code: TCode;
  message: string;
  retryable: boolean;
  occurredAt: ISODateTime;
  requestId?: UUID;
}

/* ============================================================================
   02. ENUMERACIONES DE DOMINIO
   ============================================================================ */

export const COGNITIVE_MODULE_IDS = ["ISA", "SOPHIA", "CROWN_GATEWAY", "ORION", "ARGUS"] as const;

export type CognitiveModuleId = (typeof COGNITIVE_MODULE_IDS)[number];

export const COGNITIVE_MODULE_STATUS = [
  "OPTIMAL",
  "ENGAGED",
  "ROUTING",
  "STANDBY",
  "ANALYZING",
  "DEGRADED",
  "OFFLINE",
] as const;

export type CognitiveModuleStatus = (typeof COGNITIVE_MODULE_STATUS)[number];

export const ACTIVE_VIEW_IDS = [
  "terminal",
  "presence",
  "image_studio",
  "voice_studio",
  "architecture",
  "synapse",
  "telemetry",
  "presentation",
  "hub",
  "traceability",
  "codex",
  "cattleya_finance",
  "quantum_mesh",
  "atlas_language",
  "quantum_mesh_page",
  "ledger_page",
  "eoct_page",
  "cognitive_telemetry",
  "prompt_guide",
] as const;

export type ActiveViewId = (typeof ACTIVE_VIEW_IDS)[number];

export const INFERENCE_MODES = ["cloud_federated", "local_sovereign"] as const;

export type InferenceMode = (typeof INFERENCE_MODES)[number];

export const SECURITY_SEVERITIES = ["info", "low", "medium", "high", "critical"] as const;

export type SecuritySeverity = (typeof SECURITY_SEVERITIES)[number];

/* ============================================================================
   03. MÓDULOS COGNITIVOS
   ============================================================================ */

export interface ModuleMetrics {
  activation: Percentage;
  latencyMs: Milliseconds;
  confidence: Percentage;
  throughputLabel?: string;
  throughput?: string;
  temperature: Ratio;
  activeThreads: number;
  status: CognitiveModuleStatus;
  observedAt?: ISODateTime;
}

export interface CognitiveModuleParameters {
  /** Rango válido: 0.0 a 1.0. */
  weight: Ratio;

  /** Rango válido: 0.0 a 1.0. */
  sensitivity: Ratio;

  depthLimit: number;
  enabled: boolean;
}

export interface CognitiveModule {
  id: CognitiveModuleId;
  name: string;
  acronym: string;
  fullName: string;
  role: string;
  description: string;
  corePillars: readonly string[];
  themeColor?: {
    primary: string;
    border: string;
    glow: string;
    badge: string;
    text: string;
    lightBg: string;
  };
  metrics: ModuleMetrics;
  parameters: CognitiveModuleParameters;
  updatedAt?: ISODateTime;
}

export type CognitiveModuleMap = Readonly<Record<CognitiveModuleId, CognitiveModule>>;

/* ============================================================================
   04. ENRUTAMIENTO Y DECISIONES
   ============================================================================ */

export type CognitiveModuleWeights = Readonly<{
  isa: Ratio;
  sophia: Ratio;
  orion: Ratio;
  argus: Ratio;
  crown: Ratio;
}>;

export interface RoutingDecision {
  decisionId?: UUID;
  primaryModule: CognitiveModuleId;
  moduleWeights: CognitiveModuleWeights;
  routingSummary?: string;
  routingRationale?: string;
  createdAt?: ISODateTime;
  requestId?: UUID;
  policyVersion?: string;
}

/* ============================================================================
   05. TELEMETRÍA COGNITIVA
   ============================================================================ */

export type ArgusSafetyStatus = "CLEAR" | "FLAGGED" | "ELEVATED" | "BLOCKED" | "EVIDENCE_GATED";

export interface ArgusSafetyTelemetry {
  status: ArgusSafetyStatus;
  /** null = sin evidencia; no se fabrica un score. */
  integrityScore?: Percentage | null;
  guardrailSummary?: string;
  guardrailCheck?: string;
  evaluatedAt?: ISODateTime;
}

export interface IsaResonanceTelemetry {
  emotionalTone: string;
  /** null = sin evidencia; no se fabrica un score. */
  empathyValence?: Ratio | null;
  focusSummary?: string;
  coreFocus?: string;
}

export interface SophiaReasoningTelemetry {
  logicDepthLabel?: "shallow" | "standard" | "deep" | "extended";
  /** null = sin evidencia; no se fabrica un score. */
  epistemicCertainty?: Percentage | null;
  insightSummary?: string;
  logicDepth?: string;
  heuristicInsight?: string;
}

export interface OrionExecutionTelemetry {
  actionType: string;
  executionSteps?: readonly string[];
  resourceUtilizationLabel?: string;
  resourceUtilization?: string;
}

export interface CognitiveTelemetry {
  traceId?: UUID;
  observedAt?: ISODateTime;
  argusSafety?: ArgusSafetyTelemetry;
  isaResonance?: IsaResonanceTelemetry;
  sophiaReasoning?: SophiaReasoningTelemetry;
  orionExecution?: OrionExecutionTelemetry;
}

/* ============================================================================
   06. ESTADO DE PRESENCIA ISABELLA
   ============================================================================ */

export const ISABELLA_ARCHETYPES = [
  "Serena",
  "Visionaria",
  "Poética",
  "Lúcida",
  "Protectora",
  "Radiante",
] as const;

export type IsabellaArchetype = (typeof ISABELLA_ARCHETYPES)[number];

export interface IsabellaState {
  mood: string;
  emotionalArchetype: IsabellaArchetype;
  cognitiveLoad: Ratio;
  presenceIndex: Ratio;
  feminineEleganceIndex?: Ratio;
  presentationQuality?: "standard" | "hd" | "4k" | "cinematic" | string | number;
  updatedAt?: ISODateTime;
}

/* ============================================================================
   07. ESTUDIO DE IMAGEN
   ============================================================================ */

export const IMAGE_SOURCES = ["gemini", "neural_canvas", "orion_flux", "orion_art"] as const;

export type GeneratedImageSource = (typeof IMAGE_SOURCES)[number];

export type ImageAuthor = "isabella" | "user" | "Isabella Villaseñor";

export interface GeneratedImageItem {
  id: UUID;
  assetUrl?: URLString;
  url?: URLString;
  prompt?: string;
  promptSummary?: string;
  style: string;
  aspectRatio: string;
  createdAt?: ISODateTime;
  timestamp?: ISODateTime;
  author: ImageAuthor;
  source: GeneratedImageSource;
  visibility?: "private" | "workspace" | "public";
}

/* ============================================================================
   08. VOZ Y SÍNTESIS
   ============================================================================ */

export const VOICE_TIMBRE_PRESETS = [
  "cristalina",
  "calida",
  "poetica",
  "filosofica",
  "holografica",
  "natural_fluida",
] as const;

export type VoiceTimbrePreset = (typeof VOICE_TIMBRE_PRESETS)[number];

export const SUPPORTED_VOICE_LANGUAGES = ["es-MX", "es-ES", "en-US"] as const;

export type SupportedVoiceLanguage = (typeof SUPPORTED_VOICE_LANGUAGES)[number];

export interface VoiceSettings {
  /** Rango permitido: 0.8 a 1.4. */
  pitch: number;

  /** Rango permitido: 0.7 a 1.5. */
  rate: number;

  /** Rango permitido: 0.0 a 1.0. */
  volume: Ratio;

  timbrePreset: VoiceTimbrePreset;
  preferredVoiceName?: string;
  autoSpeak: boolean;
  language: SupportedVoiceLanguage;
}

/* ============================================================================
   09. MENSAJERÍA Y CONTENIDO
   ============================================================================
   El chat se modela con una unión discriminada.
   Esto elimina combinaciones inválidas, por ejemplo:
   un mensaje de usuario con telemetría reservada para sistema.
   TypeScript puede reducir correctamente por `kind`.
   ============================================================================ */

export interface BaseTimelineItem {
  id: UUID;
  createdAt?: ISODateTime;
}

export type MessageFeedbackRating = "up" | "down";

export interface QualitativeModelFeedback {
  rating: MessageFeedbackRating;
  category?: string;
  notes?: string;
  timestamp: string;
}

/**
 * TerminalMessage se modela como una interfaz plana con todos los campos
 * opcionales excepto los comunes. Esto refleja el uso real en runtime:
 * el código UI trata cada mensaje como un "bolsa" de propiedades opcionales.
 */
export interface TerminalMessage extends BaseTimelineItem {
  kind?: string;
  content?: string;
  severity?: SecuritySeverity;
  alertCode?: string;
  resolutionHint?: string;

  attachmentIds?: readonly UUID[];

  latencyMs?: Milliseconds;
  engine?: string;
  isStreaming?: boolean;
  routingDecision?: RoutingDecision;
  cognitiveTelemetry?: CognitiveTelemetry;
  isabellaState?: IsabellaState;
  generatedImage?: GeneratedImageItem;
  audioClipUrl?: URLString;

  role?: string;
  timestamp?: string;
  sponsoredContent?: SponsoredContent;

  feedback?: MessageFeedbackRating | null;
  feedbackTimestamp?: string;
  feedbackCategory?: string;
  feedbackNotes?: string;
}

export interface UserMessage extends BaseTimelineItem {
  kind: "user_message";
  content: string;
  attachmentIds?: readonly UUID[];
  role?: string;
  timestamp?: string;
  isabellaState?: IsabellaState;
}

export interface IsabellaMessage extends BaseTimelineItem {
  kind: "isabella_message";
  content: string;
  latencyMs?: Milliseconds;
  engine?: string;
  isStreaming: boolean;
  routingDecision?: RoutingDecision;
  cognitiveTelemetry?: CognitiveTelemetry;
  isabellaState?: IsabellaState;
  generatedImage?: GeneratedImageItem;
  audioClipUrl?: URLString;
  role?: string;
  timestamp?: string;
  sponsoredContent?: SponsoredContent;
}

export interface SystemMessage extends BaseTimelineItem {
  kind: "system_message";
  content: string;
  severity: SecuritySeverity;
  role?: string;
  timestamp?: string;
}

export interface ArgusAlertMessage extends BaseTimelineItem {
  kind: "argus_alert";
  content: string;
  severity: Exclude<SecuritySeverity, "info">;
  alertCode: string;
  resolutionHint?: string;
  role?: string;
  timestamp?: string;
}

/* ============================================================================
   10. PUBLICIDAD Y PATROCINIO
   ============================================================================
   Un anuncio no es un mensaje ni puede presentarse como respuesta de Isabella.
   Es una unidad de timeline separada, claramente rotulada y auditable.
   ============================================================================ */

export type SponsoredContentStatus =
  "eligible" | "served" | "dismissed" | "clicked" | "expired" | "blocked";

export interface SponsoredContent {
  kind?: "sponsored_content";
  type?: string;
  id?: UUID;
  createdAt?: ISODateTime;

  disclosureLabel?: "Patrocinado";
  advertiserName?: string;
  campaignId?: UUID;
  placement?: "chat-sponsored-card";

  title?: string;
  description?: string;
  ctaText?: string;
  ctaUrl?: URLString;
  destinationUrl?: URLString;

  imageUrl?: URLString;
  category?: string;
  adId?: string;

  publisherId?: string;
  requestId?: UUID;
  impressionToken?: string;

  status: SponsoredContentStatus;
  requiresAdvertisingConsent: true;
}

/**
 * Timeline del terminal:
 * cada elemento se identifica explícitamente por `kind`.
 */
export type TerminalTimelineItem = TerminalMessage | SponsoredContent;

/* ============================================================================
   11. PERFILES DE OPERACIÓN
   ============================================================================ */

export const PRESET_PROFILE_IDS = [
  "prime",
  "empathic",
  "strategic",
  "sentinel",
  "executor",
  "synergistic",
] as const;

export type PresetProfileId = (typeof PRESET_PROFILE_IDS)[number];

export interface PresetProfile {
  id: PresetProfileId;
  name: string;
  tagline: string;
  description: string;
  weights: CognitiveModuleWeights;
  isSystemProfile?: boolean;
}

/* ============================================================================
   12. GOBERNANZA Y SOBERANÍA
   ============================================================================ */

export type CryptographicEnclaveState = "verified" | "audited" | "degraded" | "unavailable";

export type DataBoundary = "strict_territorial" | "federated_monitored" | "local_only";

export interface SecurityGovernanceLevel {
  levelNumber: 1 | 2 | 3 | 4 | 5;
  levelName: string;
  integrityPercent: Percentage;
  argusSentinelActive: boolean;
  cryptographicEnclave: CryptographicEnclaveState;
  dataBoundary: DataBoundary;
  sha256LedgerDigest: SHA256Digest;
  assessedAt?: ISODateTime;
}

export interface InferenceTransitionEvent {
  eventId?: UUID;
  fromMode?: InferenceMode;
  toMode?: InferenceMode;
  reasonSummary?: string;
  reason?: string;
  timestamp?: ISODateTime;
  occurredAt?: ISODateTime;
  sovereigntyPreserved?: boolean;
  latencyDeltaMs?: Milliseconds;
  requestId?: UUID;
}

/* ============================================================================
   13. PRESENTACIÓN Y EVALUACIÓN
   ============================================================================ */

export const PRESENTATION_CATEGORIES = [
  "Fundamento",
  "Arquitectura",
  "Territorio",
  "Gobernanza",
  "Soberanía",
  "Memoria & Seguridad",
  "Evaluación",
  "Visión Global",
] as const;

export type PresentationCategory = (typeof PRESENTATION_CATEGORIES)[number];

export interface PresentationChapter {
  id: string;
  number: number;
  title: string;
  subtitle: string;
  category: PresentationCategory;
  summary: string;
  content: readonly string[];
  keyQuote?: string;
  diagramAscii?: string;
  highlights: readonly string[];
}

export interface EvaluatorDeclaration {
  evaluator: string;
  model: string;
  sha256: SHA256Digest;
  evaluationState: "pending" | "running" | "completed" | "failed";
  dossierSummary: string;
  evaluatedAt?: ISODateTime;
  timestamp?: ISODateTime;
}

/* ============================================================================
   14. ESTADO GLOBAL CROWN
   ============================================================================ */

export type ActiveHead = "Alpha" | "Beta";

export interface CrownSystemState {
  isProcessing: boolean;
  activePreset: PresetProfileId;
  modules: CognitiveModuleMap;
  activePulse: Ratio;
  soundEnabled: boolean;
  autoScroll: boolean;
  speechSynthesisEnabled: boolean;
  isSpeaking: boolean;
  isListening: boolean;
  activeView: ActiveViewId;
  totalTokensProcessed: number;
  systemUptimeSeconds?: number;
  lastRoutingEvent: Nullable<RoutingDecision>;
  voiceSettings: VoiceSettings;
  isabellaMood: IsabellaState;
  activeHead: ActiveHead;
  inferenceMode: InferenceMode;
  securityGovernance: SecurityGovernanceLevel;
  lastInferenceTransition: Nullable<InferenceTransitionEvent>;
}

/* ============================================================================
   15. EVENTOS DE INTERFAZ Y OBSERVABILIDAD
   ============================================================================
   Se prohíbe adjuntar contenido conversacional a estos eventos.
   ============================================================================ */

export type IsabellaClientEvent =
  | {
      type: "view_changed";
      viewId: ActiveViewId;
      occurredAt: ISODateTime;
    }
  | {
      type: "view_error";
      viewId: ActiveViewId;
      errorCode: string;
      occurredAt: ISODateTime;
    }
  | {
      type: "consent_updated";
      category: "advertising";
      value: "granted" | "denied";
      occurredAt: ISODateTime;
    }
  | {
      type: "sponsored_impression";
      campaignId: UUID;
      placement: "chat-sponsored-card";
      occurredAt: ISODateTime;
    }
  | {
      type: "sponsored_click";
      campaignId: UUID;
      placement: "chat-sponsored-card";
      occurredAt: ISODateTime;
    }
  | {
      type: "sponsored_dismissed";
      campaignId: UUID;
      placement: "chat-sponsored-card";
      occurredAt: ISODateTime;
    };

/* ============================================================================
   16. DECLARACIONES DE PROVEEDORES EXTERNOS
   ============================================================================ */

declare global {
  interface Window {
    /**
     * Pixel publicitario. Puede estar ausente si no existe consentimiento,
     * si se usa un bloqueador o si la red falla.
     */
    idlen?: {
      (command: "init", appId: string): void;

      (
        command: "track",
        event: string,
        data?: ReadonlyRecord<string | number | boolean | null>,
      ): void;

      (command: "click", adId: string): void;
      (command: "impression", token: string): void;
    };

    /**
     * Fachada de consentimiento definida en index.html.
     */
    isabellaAds?: {
      consent: "unknown" | "granted" | "denied";
      grant: () => void;
      deny: () => void;
      track: (
        eventName: string,
        properties?: ReadonlyRecord<string | number | boolean | null>,
      ) => void;
    };
  }
}
