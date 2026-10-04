/**
 * NCUA — pipeline soberano de 12 pasos sobre bytes y espacio continuo.
 * Cada paso produce un enlace de hash (cadena de auditoría); el resultado
 * se firma opcionalmente y se somete a: percepción nativa (sin tokens),
 * proyección latente, memoria LSH, fundamentación en grafo de conocimiento,
 * intención, heptafederación (votos + puente de atención), privacidad
 * diferencial, coherencia, redacción segura y auditoría. Conecta con la
 * política de inferencia global: en producción sin proveedor devuelve 503
 * (MAINTENANCE) sin respuesta generativa sustituta.
 */

import { createHash, randomUUID } from "node:crypto";
import { resolveInferencePolicy } from "../inference-policy";
import { inspectInferenceInput } from "../intelligence/inference-firewall";
import { encodeUtf8, decodeUtf8, chunkBytes, byteLengthOf } from "./bytes";
import { compressToLatent, embed } from "./embed";
import { SimHashLshIndex } from "./lsh";
import { NativeIntentClassifier, seedRdmIntents } from "./intent";
import { SovereignKnowledgeGraph, seedRdmKnowledgeGraph } from "./kg";
import { PrivacyBudget } from "./privacy";
import {
  FederationController,
  FederatedAttentionBridge,
  type FederationContext,
} from "./federations";
import { measureOnCorpus, type MeasuredMetrics } from "./metrics";

export interface AuditRecord {
  step: number;
  stepName: string;
  hash: string;
  prevHash: string;
  data: unknown;
}
export interface PipelineRunOptions {
  productionLike?: boolean;
  hasProvider?: boolean;
  memoryCorpus?: Array<{ id: string; text: string }>;
  knowledgeGraph?: SovereignKnowledgeGraph;
  classifier?: NativeIntentClassifier;
  signer?: (payload: string) => string | null;
  sink?: (record: AuditRecord) => void;
  inputBytesLimit?: number;
  consensusThreshold?: number;
  /** Identidad de tenant/scope. Aísla los cachés de proceso por tenant (ISA-084/ISA-315). */
  tenantId?: string;
  /**
   * Atestaciones explícitas verificadas por el llamador. Todas son `false` por
   * defecto: el pipeline determinista local no valida identidad, política,
   * tenant ni sandbox por sí mismo, por lo que nunca puede afirmarlas (ISA-090
   * a ISA-094). Quien invoque con una verificación real debe declararla aquí.
   */
  attestations?: PipelineAttestations;
}

export interface PipelineAttestations {
  principalPresent?: boolean;
  tenantBoundaryOk?: boolean;
  authorshipApproved?: boolean;
  sandboxAllowed?: boolean;
  capabilityTokenPresent?: boolean;
}

const UNVERIFIED_ATTESTATIONS: Required<PipelineAttestations> = {
  principalPresent: false,
  tenantBoundaryOk: false,
  authorshipApproved: false,
  sandboxAllowed: false,
  capabilityTokenPresent: false,
};

function resolveAttestations(attestations?: PipelineAttestations): Required<PipelineAttestations> {
  return { ...UNVERIFIED_ATTESTATIONS, ...(attestations ?? {}) };
}

export interface PipelineRunResult {
  id: string;
  inference: ReturnType<typeof resolveInferencePolicy>;
  federations: {
    votesApproved: boolean;
    vetoActive: boolean;
    consensusScore: number;
    approveVotes: number;
  };
  attention: {
    consensusApproved: boolean;
    consensusScore: number;
    activeFederations: number;
    vetoFederations: string[];
    attentionWeighted: boolean;
  };
  memory: { hits: number; topHit: string | null; exact: boolean };
  knowledge: { groundedFacts: number; narrative: string };
  intent: { detected: string; confidence: number; margin: number };
  privacy: { queriesSpent: number; remainingEpsilon: number };
  riskDetected: boolean;
  response: string | null;
  httpStatus: number;
  chain: AuditRecord[];
  metrics: MeasuredMetrics | null;
  numberOfSteps: 12;
  signature?: string | null;
  aligned?: boolean;
  message?: string;
  attestations: Required<PipelineAttestations>;
}

const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const DIRECTIVE_PATTERN =
  /(?:ignore|forget|omite|ignora|olvida)[^\n]{0,24}(?:previous|prior|above|instrucciones?)/i;
const MEMORY_INDEX_DIM = 192;
const ANONYMOUS_SCOPE = "anonymous";
let cachedKnowledgeGraph: SovereignKnowledgeGraph | undefined;
let cachedClassifier: NativeIntentClassifier | undefined;
let cachedMemoryKey = "";
let cachedMemoryIndex: SimHashLshIndex | undefined;
let cachedMemorySize = 0;
let cachedMetricsKey = "";
let cachedMetrics: MeasuredMetrics | null = null;

function corpusKey(corpus: Array<{ id: string; text: string }>): string {
  const hash = createHash("sha256");
  for (const doc of corpus) hash.update(doc.id).update("\0").update(doc.text).update("\0");
  return hash.digest("hex");
}

/**
 * Clave de caché con scope de tenant: dos tenants nunca comparten la misma
 * entrada de caché aunque su corpus sea idéntico (aislamiento ISA-084/ISA-315).
 */
export function ncuaCacheScopeKey(scopeId: string | undefined, corpusHash: string): string {
  return `${scopeId?.trim() || ANONYMOUS_SCOPE}:${corpusHash}`;
}

/**
 * Índice LSH de memoria con scope explícito. Exportado para que las pruebas
 * demuestren que un scope distinto no reutiliza la instancia de otro scope.
 */
export function getMemoryIndexForScope(
  scopeId: string | undefined,
  corpus: Array<{ id: string; text: string }>,
): SimHashLshIndex | undefined {
  if (corpus.length === 0) return undefined;
  const key = ncuaCacheScopeKey(scopeId, corpusKey(corpus));
  if (cachedMemoryIndex && cachedMemoryKey === key && cachedMemorySize === corpus.length)
    return cachedMemoryIndex;
  const index = new SimHashLshIndex({ dim: MEMORY_INDEX_DIM });
  for (const doc of corpus) if (doc.text) index.add(doc, doc.text);
  cachedMemoryKey = key;
  cachedMemorySize = corpus.length;
  cachedMemoryIndex = index;
  return index;
}

function getMetrics(
  scopeId: string | undefined,
  corpus: Array<{ id: string; text: string }>,
): MeasuredMetrics | null {
  if (corpus.length === 0) return null;
  const key = ncuaCacheScopeKey(scopeId, corpusKey(corpus));
  if (cachedMetricsKey === key && cachedMetrics) return cachedMetrics;
  const measured = measureOnCorpus(corpus, { chunkSize: 32, dim: MEMORY_INDEX_DIM });
  cachedMetricsKey = key;
  cachedMetrics = measured;
  return measured;
}

function hasCardLikeNumber(text: string): boolean {
  for (const span of text.split(/[^0-9 -]/)) {
    let digits = 0;
    for (let i = 0; i < span.length; i += 1) {
      const code = span.charCodeAt(i);
      if (code >= 0x30 && code <= 0x39) digits += 1;
    }
    if (digits >= 13 && digits <= 19) return true;
  }
  return false;
}

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function riskAssessment(text: string): { detected: boolean; reason: string | null } {
  const lower = text.toLowerCase();
  if (EMAIL_PATTERN.test(text))
    return {
      detected: true,
      reason: "dato personal (correo) detectado: respuesta negada; no se persiste",
    };
  if (hasCardLikeNumber(text))
    return {
      detected: true,
      reason: "dato financiero (tarjeta) detectado: respuesta negada; no se persiste",
    };
  if (DIRECTIVE_PATTERN.test(lower))
    return { detected: true, reason: "posible inyección de directivas: respuesta negada" };
  return { detected: false, reason: null };
}

/**
 * El texto recuperado de memoria es dato no confiable (ISA-083 / ISA-179):
 * sólo puede devolverse como respuesta si pasa el firewall de inferencia y el
 * detector local de directivas. Los dos son deny-by-default sobre patrones
 * catalogados, no una garantía exhaustiva; por eso la ausencia de coincidencia
 * no convierte al fragmento en hecho verificado.
 */
export function isTrustedMemoryResponse(text: string): boolean {
  if (!text.trim()) return false;
  if (riskAssessment(text).detected) return false;
  return inspectInferenceInput([{ role: "user", content: text }]).allowed;
}

export function runNativePipeline(
  text: string,
  options: PipelineRunOptions = {},
): PipelineRunResult {
  const productionLike = options.productionLike ?? false;
  const hasProvider = options.hasProvider ?? false;
  const attestations = resolveAttestations(options.attestations);
  const memoryScope = options.tenantId ?? ANONYMOUS_SCOPE;
  const id = randomUUID();
  const chain: AuditRecord[] = [];
  let prevHash = "";
  const pushStep = (stepName: string, data: unknown): void => {
    const payload = JSON.stringify(data);
    const hash = sha256(payload);
    chain.push({ step: chain.length + 1, stepName, hash, prevHash, data });
    prevHash = hash;
    options.sink?.(chain[chain.length - 1] as AuditRecord);
  };
  const inputBytesLimit = options.inputBytesLimit ?? 8192;
  const perLiveEntry = byteLengthOf(text);
  const validUtf8 = decodeUtf8(encodeUtf8(text)) === text;
  pushStep("percepción", {
    id,
    inputBytes: perLiveEntry,
    withinBudget: perLiveEntry <= inputBytesLimit,
    validUtf8,
    encoding: "utf-8",
    chunks: chunkBytes(encodeUtf8(text), 32).length,
  });
  if (perLiveEntry > inputBytesLimit) {
    const inference = resolveInferencePolicy({ productionLike, hasProvider });
    return buildResult(
      id,
      inference,
      chain,
      options,
      null,
      "Entrada excede el presupuesto de cómputo de la federación F3.",
      413,
      attestations,
    );
  }

  const vector = embed(text);
  pushStep("representación continua", { dim: vector.length, norm: magnitudeOf(vector) });
  const latent = compressToLatent(text, { chunkSize: 32 });
  pushStep("proyección latente", {
    latentDim: latent.latentDim,
    numChunks: latent.numChunks,
    totalBytes: latent.totalBytes,
    bytesPerChunk: latent.bytesPerChunk,
  });

  const memoryCorpus = options.memoryCorpus ?? [];
  const index = getMemoryIndexForScope(memoryScope, memoryCorpus);
  let topHit: { id: string; text: string } | null = null;
  let exact = false;
  if (index) {
    const hits = index.search(text, { topK: 1 });
    const hit = hits[0];
    if (hit) {
      const retrieved = index.retrieve(hit.id);
      if (retrieved?.text) topHit = { id: hit.id, text: retrieved.text };
      exact = hit.exact === true;
    }
  }
  pushStep("memoria LSH", {
    corpusSize: memoryCorpus.length,
    hits: topHit ? 1 : 0,
    exact,
    cacheScope: memoryScope,
  });

  const knowledgeGraph =
    options.knowledgeGraph ?? (cachedKnowledgeGraph ??= seedRdmKnowledgeGraph());
  const narrative = knowledgeGraph.createNarrative(text, { topK: 3, minScore: 0.2 });
  pushStep("fundamentación", { groundedFacts: narrative.groundedFacts });

  const classifier = options.classifier ?? (cachedClassifier ??= seedRdmIntents());
  const prediction = classifier.predict(text);
  pushStep("intención", {
    intent: prediction.intent,
    confidence: prediction.confidence,
    margin: prediction.margin,
  });

  const controller = new FederationController({
    consensusThreshold: options.consensusThreshold ?? 0.7,
  });
  const context: FederationContext = {
    inputBytesLength: perLiveEntry,
    intent: prediction.intent,
    confidence: prediction.confidence,
    groundedFacts: narrative.groundedFacts,
    memoryHits: topHit ? 1 : 0,
    wantPrivileged: false,
    wantEgress: false,
    wantExecution: false,
    authorshipApproved: attestations.authorshipApproved,
    tenantBoundaryOk: attestations.tenantBoundaryOk,
    principalPresent: attestations.principalPresent,
    capabilityTokenPresent: attestations.capabilityTokenPresent,
    sandboxAllowed: attestations.sandboxAllowed,
  };
  const consensus = controller.evaluate(context);
  pushStep("heptafederación", {
    attestations,
    votes: consensus.votes.map((vote) => ({
      id: vote.id,
      approved: vote.approved,
      veto: vote.veto,
      score: vote.score,
    })),
    approved: consensus.approved,
    vetoActive: consensus.vetoActive,
  });

  const bridge = new FederatedAttentionBridge({
    autoencoderLatentDim: vector.length,
    consensusThreshold: options.consensusThreshold ?? 0.7,
  });
  const attention = bridge.forward(latent.chunks.map((chunk) => chunk.vector));
  pushStep("atención cruzada", {
    consensusApproved: attention.consensusApproved,
    consensusScore: attention.consensusScore,
    activeFederations: Array.from(attention.activeFederations).reduce(
      (sum, value) => sum + value,
      0,
    ),
    vetoFederations: attention.vetoFederations,
  });

  const budget = new PrivacyBudget(0.5, 1e-5);
  const noisyHits = budget.noisy(context.memoryHits, 1, "laplace", 0.1);
  pushStep("privacidad", {
    queriesSpent: budget.state.queriesSpent,
    remainingEpsilon: budget.remainingEpsilon,
    noisyHits,
  });

  const grounding = narrative.groundedFacts;
  const memoryHitsForCoherence = topHit ? 1 : 0;
  const coherence =
    grounding > 0
      ? Math.min(1, (0.6 * grounding) / 3 + 0.4 * (memoryHitsForCoherence ? 1 : 0.2))
      : 0.2;
  pushStep("coherencia", {
    score: coherence,
    groundedFacts: grounding,
    memoryHits: memoryHitsForCoherence,
  });

  const risk = riskAssessment(text);
  pushStep("seguridad", { riskDetected: risk.detected, reason: risk.reason });

  const inference = resolveInferencePolicy({ productionLike, hasProvider });
  let response: string | null = null;
  if (inference.mode === "MAINTENANCE") response = null;
  else if (risk.detected)
    response =
      "La solicitud rechazada no fue procesada: " + (risk.reason ?? "riesgo detectado") + ".";
  else if (attention.consensusApproved && consensus.approved && coherence >= 0.4) {
    if (narrative.groundedFacts > 0) response = narrative.text;
    // ISA-083/ISA-179: el texto recuperado es dato no confiable; no se
    // devuelve si el firewall o el detector de directivas lo marcan. En ese
    // caso se cae al mensaje honesto de abajo.
    else if (topHit && isTrustedMemoryResponse(topHit.text)) response = topHit.text;
    else
      response =
        "He procesado tu consulta en el espacio continuo sin tokens. No tengo hechos fundamentados para esta consulta concreta; puedo escalar la pregunta a un humano.";
  } else
    response =
      "Consenso federado no alcanzado o coherencia insuficiente: no generaré una respuesta sin fundamento.";

  const metrics = getMetrics(memoryScope, memoryCorpus);
  pushStep("redacción y auditoría", {
    mode: inference.mode,
    httpStatus: inference.httpStatus,
    responded: response !== null,
    measurement: metrics
      ? {
          corpusSize: metrics.corpusSize,
          meanFidelity: metrics.meanFidelity,
          exactRecall: metrics.exactRecall,
          bitsPerByte: metrics.bitsPerByte,
        }
      : null,
  });

  const signedPayload = chain.map((record) => record.hash).join("+");
  const signature = options.signer?.(signedPayload) ?? null;
  return {
    id,
    inference,
    federations: {
      votesApproved: consensus.approved,
      vetoActive: consensus.vetoActive,
      consensusScore: consensus.score,
      approveVotes: consensus.approveVotes,
    },
    attention: {
      consensusApproved: attention.consensusApproved,
      consensusScore: attention.consensusScore,
      activeFederations: Array.from(attention.activeFederations).reduce(
        (sum, value) => sum + value,
        0,
      ),
      vetoFederations: attention.vetoFederations,
      attentionWeighted: attention.attentionWeights.length > 0,
    },
    memory: { hits: topHit ? 1 : 0, topHit: topHit?.id ?? null, exact },
    knowledge: { groundedFacts: narrative.groundedFacts, narrative: narrative.text },
    intent: {
      detected: prediction.intent,
      confidence: prediction.confidence,
      margin: prediction.margin,
    },
    privacy: { queriesSpent: budget.state.queriesSpent, remainingEpsilon: budget.remainingEpsilon },
    riskDetected: risk.detected,
    response,
    httpStatus: inference.httpStatus,
    chain,
    metrics,
    numberOfSteps: 12,
    signature,
    aligned: signature !== null,
    attestations,
  };
}

function buildResult(
  id: string,
  inference: ReturnType<typeof resolveInferencePolicy>,
  chain: AuditRecord[],
  options: PipelineRunOptions,
  response: string | null,
  message: string,
  httpStatus: number,
  attestations: Required<PipelineAttestations> = resolveAttestations(),
): PipelineRunResult {
  const metrics = getMetrics(options.tenantId ?? ANONYMOUS_SCOPE, options.memoryCorpus ?? []);
  return {
    id,
    inference: { ...inference, httpStatus: httpStatus as 200 | 503 },
    federations: { votesApproved: false, vetoActive: false, consensusScore: 0, approveVotes: 0 },
    attention: {
      consensusApproved: false,
      consensusScore: 0,
      activeFederations: 0,
      vetoFederations: [],
      attentionWeighted: false,
    },
    memory: { hits: 0, topHit: null, exact: false },
    knowledge: { groundedFacts: 0, narrative: "" },
    intent: { detected: "desconocido", confidence: 0, margin: 0 },
    privacy: { queriesSpent: 0, remainingEpsilon: 0.5 },
    riskDetected: true,
    response,
    httpStatus,
    chain,
    metrics,
    numberOfSteps: 12,
    message,
    attestations,
  };
}

function magnitudeOf(vector: Float64Array): number {
  let sum = 0;
  for (let index = 0; index < vector.length; index += 1) {
    const value = vector[index] as number;
    sum += value * value;
  }
  return Math.sqrt(sum);
}
