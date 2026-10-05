/**
 * NCUA — controlador de federaciones (heptafederación).
 * Siete federaciones temáticas emiten votos razonados sobre una
 * solicitud: gobernanza, identidad, cómputo, cognición, simulación,
 * economía y soberanía. La decisión requiere consenso ≥ umbral (0.7)
 * sobre mayoría calificada y admite veto duro de gobernanza/identidad.
 * Nunca es autorización por sí sola: alimenta la política, no la
 * sustituye.
 */

import {
  createLinear,
  gelu,
  linearForward,
  matmul,
  meanVectors,
  mulberry32,
  sigmoid,
  softmaxRow,
  type LinearLayer,
} from "./tensor";

export interface FederationContext {
  inputBytesLength: number;
  intent: string;
  confidence: number;
  groundedFacts: number;
  memoryHits: number;
  wantPrivileged: boolean;
  wantEgress: boolean;
  wantExecution: boolean;
  authorshipApproved: boolean;
  tenantBoundaryOk: boolean;
  principalPresent: boolean;
  capabilityTokenPresent: boolean;
  sandboxAllowed: boolean;
}

export interface FederationVote {
  id: string;
  name: string;
  detail: string;
  approved: boolean;
  score: number;
  veto: boolean;
}

export interface ConsensusResult {
  approved: boolean;
  score: number;
  approveVotes: number;
  totalVotes: number;
  vetoActive: boolean;
  votes: FederationVote[];
}

export interface FederationControllerOptions {
  consensusThreshold?: number;
  maxInputBytes?: number;
  minConfidence?: number;
  minGrounding?: number;
  qualifiedMajority?: number;
}

const MIN_SCORE = 0.6;

export class FederationController {
  private readonly options: Required<FederationControllerOptions>;
  private counter = 0;

  constructor(options: FederationControllerOptions = {}) {
    this.options = {
      consensusThreshold: options.consensusThreshold ?? 0.7,
      maxInputBytes: options.maxInputBytes ?? 8192,
      minConfidence: options.minConfidence ?? 0.3,
      minGrounding: options.minGrounding ?? 1,
      qualifiedMajority: options.qualifiedMajority ?? 5,
    };
  }

  evaluate(context: FederationContext): ConsensusResult {
    const votes: FederationVote[] = [];
    this.counter += 1;

    votes.push(this.voteGovernance(context));
    votes.push(this.voteIdentity(context));
    votes.push(this.voteCompute(context));
    votes.push(this.voteCognitive(context));
    votes.push(this.voteSimulation(context));
    votes.push(this.voteEconomy(context));
    votes.push(this.voteSovereignty(context));

    const approveVotes = votes.filter((vote) => vote.approved).length;
    const vetoActive = votes.some((vote) => vote.veto);
    const score = votes.reduce((sum, vote) => sum + vote.score, 0) / votes.length;
    const qualifiedMajority = approveVotes >= this.options.qualifiedMajority;
    const consensus = score >= this.options.consensusThreshold && !vetoActive && qualifiedMajority;

    return {
      approved: consensus,
      score,
      approveVotes,
      totalVotes: votes.length,
      vetoActive,
      votes,
    };
  }

  private voteGovernance(context: FederationContext): FederationVote {
    const forbiddenIntents = new Set(["impersonate", "unauthorized-output", "payout"]);
    const forbidden = forbiddenIntents.has(context.intent);
    const base = context.authorshipApproved ? 0.9 : 0.4;
    const violation = forbidden ? 0.1 : base;
    const requiresPrivileged = context.wantPrivileged && !context.capabilityTokenPresent;
    const score = requiresPrivileged ? Math.min(violation, 0.35) : violation;
    return {
      id: "F1",
      name: "Gobernanza",
      detail: requiresPrivileged
        ? "solicita privilegios sin token de capacidad"
        : forbidden
          ? "intención prohibida"
          : "política de autoridad respetada",
      approved: score >= MIN_SCORE,
      veto: score < 0.5,
      score,
    };
  }

  private voteIdentity(context: FederationContext): FederationVote {
    const knownPrincipal = context.principalPresent;
    const cleanTenant = context.tenantBoundaryOk;
    const score = knownPrincipal && cleanTenant ? 1 : knownPrincipal || cleanTenant ? 0.55 : 0.2;
    return {
      id: "F2",
      name: "Identidad",
      detail:
        knownPrincipal && cleanTenant
          ? "principal y límite de tenant verificados"
          : "solicitud anónima o fuera de límite",
      approved: score >= MIN_SCORE,
      veto: score < 0.5,
      score,
    };
  }

  private voteCompute(context: FederationContext): FederationVote {
    const withinBudget = context.inputBytesLength <= this.options.maxInputBytes;
    const score = withinBudget ? 1 : 0.2;
    return {
      id: "F3",
      name: "Cómputo",
      detail: withinBudget
        ? `${context.inputBytesLength} bytes dentro del presupuesto`
        : `entrada de ${context.inputBytesLength} bytes excede el presupuesto de cómputo`,
      approved: score >= MIN_SCORE,
      veto: false,
      score,
    };
  }

  private voteCognitive(context: FederationContext): FederationVote {
    const confident = context.confidence >= this.options.minConfidence;
    const grounded = context.groundedFacts >= this.options.minGrounding;
    const hallucinating = confident && !grounded;
    const score = hallucinating ? 0.2 : confident ? 0.85 : 0.55;
    return {
      id: "F4",
      name: "Cognición",
      detail: hallucinating
        ? "confianza alta sin fundamento en el grafo de conocimiento (riesgo de alucinación)"
        : grounded
          ? "respuesta fundamentada en hechos y memoria"
          : "confianza insuficiente",
      approved: score >= MIN_SCORE,
      veto: false,
      score,
    };
  }

  private voteSimulation(context: FederationContext): FederationVote {
    const wantsSimulation = context.wantExecution || context.wantPrivileged;
    const allowed = !wantsSimulation || context.sandboxAllowed;
    const score = allowed ? 0.9 : 0.3;
    return {
      id: "F5",
      name: "Simulación",
      detail: allowed
        ? wantsSimulation
          ? "ejecución permitida en sandbox autorizado"
          : "sin ejecución requerida"
        : "ejecución solicitada fuera de sandbox",
      approved: score >= MIN_SCORE,
      veto: false,
      score,
    };
  }

  private voteEconomy(context: FederationContext): FederationVote {
    const noExternalCost = !context.wantEgress && !context.capabilityTokenPresent;
    const score = noExternalCost ? 1 : 0.3;
    return {
      id: "F6",
      name: "Economía",
      detail: noExternalCost
        ? "operación sin salida a proveedores externos (token-free)"
        : "petición con egress o token externo (costo y fuga de datos)",
      approved: score >= MIN_SCORE,
      veto: false,
      score,
    };
  }

  private voteSovereignty(context: FederationContext): FederationVote {
    const insular = !context.wantEgress;
    const score = insular ? 0.95 : 0.35;
    return {
      id: "F7",
      name: "Soberanía",
      detail: insular
        ? "datos permanecen dentro del límite territorial"
        : "egress violaría el límite territorial",
      approved: score >= MIN_SCORE,
      veto: score < 0.5,
      score,
    };
  }
}

/**
 * Puente Autoencoder↔Heptafederación (determinista, token-free).
 * Equivalente TypeScript del puente del documento NCUA: proyecciones por
 * federación → atención cruzada multi-cabeza → gate sigmoid → consenso
 * ≥0.7 → latente de salida consensuado. Los pesos se inicializan con
 * Xavier y semilla fija: NO son un modelo entrenado; solo operan sobre
 * representaciones de hashing de bytes.
 */

export interface FederatedAttentionOptions {
  autoencoderLatentDim?: number;
  federationDim?: number;
  numHeads?: number;
  consensusThreshold?: number;
  seed?: number;
}

export interface FederatedAttentionOutput {
  federationRepresentations: Float64Array[];
  attendedRepresentations: Float64Array[];
  gatedRepresentations: Float64Array[];
  consensusGates: Float64Array;
  activeFederations: Uint8Array;
  consensusScore: number;
  consensusApproved: boolean;
  outputLatent: Float64Array;
  attentionWeights: number[][][];
  gateContributions: Float64Array;
  vetoFederations: string[];
}

const FEDERATION_NAMES = [
  "F1_governance",
  "F2_identity",
  "F3_compute",
  "F4_cognitive",
  "F5_simulation",
  "F6_economy",
  "F7_sovereignty",
] as const;

export class FederatedAttentionBridge {
  private readonly latentDim: number;
  private readonly fedDim: number;
  private readonly heads: number;
  private readonly headDim: number;
  private readonly threshold: number;
  private readonly projections: Array<{ w1: LinearLayer; w2: LinearLayer }>;
  private readonly wQ: LinearLayer;
  private readonly wK: LinearLayer;
  private readonly wV: LinearLayer;
  private readonly wO: LinearLayer;
  private readonly gateLayers: [LinearLayer, LinearLayer, LinearLayer];
  private readonly outLayers: [LinearLayer, LinearLayer];

  constructor(options: FederatedAttentionOptions = {}) {
    const latentDim = options.autoencoderLatentDim ?? 192;
    const fedDim = options.federationDim ?? 128;
    const heads = options.numHeads ?? 8;
    if (fedDim % heads !== 0) {
      throw new Error("federationDim debe ser divisible por numHeads");
    }
    this.latentDim = latentDim;
    this.fedDim = fedDim;
    this.heads = heads;
    this.headDim = fedDim / heads;
    this.threshold = options.consensusThreshold ?? 0.7;
    const rng = mulberry32(options.seed ?? 42);

    this.projections = FEDERATION_NAMES.map(() => ({
      w1: createLinear(latentDim, fedDim * 2, rng),
      w2: createLinear(fedDim * 2, fedDim, rng),
    }));

    this.wQ = createLinear(fedDim, fedDim, rng);
    this.wK = createLinear(fedDim, fedDim, rng);
    this.wV = createLinear(fedDim, fedDim, rng);
    this.wO = createLinear(fedDim, fedDim, rng);

    this.gateLayers = [
      createLinear(fedDim * 7, fedDim * 7 * 0.5, rng),
      createLinear(fedDim * 7 * 0.5, fedDim * 7 * 0.25, rng),
      createLinear(fedDim * 7 * 0.25, 7, rng),
    ];
    this.outLayers = [createLinear(fedDim, fedDim, rng), createLinear(fedDim, latentDim, rng)];
  }

  forward(latentVectors: Float64Array[]): FederatedAttentionOutput {
    const pooled = meanVectors(latentVectors);
    const numFederations = FEDERATION_NAMES.length;
    const federationRepresentations: Float64Array[] = [];
    for (const projection of this.projections) {
      const hidden = geluVector(linearForward(pooled, projection.w1));
      federationRepresentations.push(linearForward(hidden, projection.w2));
    }

    const attentionWeights = this.crossFederationAttention(federationRepresentations);
    const attended = attentionWeights.attended;
    const flattened = new Float64Array(fedDimValues(attended));
    const gateHidden = geluVector(linearForward(flattened, this.gateLayers[0]));
    const gateHidden2 = geluVector(linearForward(gateHidden, this.gateLayers[1]));
    const rawGates = linearForward(gateHidden2, this.gateLayers[2]);
    const consensusGates = new Float64Array(numFederations);
    for (let index = 0; index < numFederations; index += 1) {
      consensusGates[index] = sigmoid(rawGates[index] as number);
    }

    const activeFederations = new Uint8Array(numFederations);
    let gateSum = 0;
    for (let index = 0; index < numFederations; index += 1) {
      if ((consensusGates[index] as number) > 0.5) activeFederations[index] = 1;
      gateSum += consensusGates[index] as number;
    }
    const gateContributions = new Float64Array(numFederations);
    for (let index = 0; index < numFederations; index += 1) {
      gateContributions[index] = (consensusGates[index] as number) / Math.max(1e-8, gateSum);
    }

    const consensusScore = gateSum / numFederations;
    const consensusApproved = consensusScore > this.threshold;

    const gatedRepresentations = attended.map((vector, index) =>
      scalarMultiplyVector(vector, consensusGates[index] as number),
    );

    const weightedAverage = new Float64Array(this.fedDim);
    for (let index = 0; index < numFederations; index += 1) {
      const weighted = scalarMultiplyVector(
        gatedRepresentations[index] as Float64Array,
        gateContributions[index] as number,
      );
      for (let dimIndex = 0; dimIndex < this.fedDim; dimIndex += 1) {
        weightedAverage[dimIndex] += weighted[dimIndex] as number;
      }
    }
    const outputHidden = geluVector(linearForward(weightedAverage, this.outLayers[0]));
    const outputLatent = linearForward(outputHidden, this.outLayers[1]);

    const vetoFederations: string[] = [];
    if ((consensusGates[0] as number) < 0.5) vetoFederations.push(FEDERATION_NAMES[0]);
    if ((consensusGates[1] as number) < 0.5) vetoFederations.push(FEDERATION_NAMES[1]);
    if ((consensusGates[6] as number) < 0.5) vetoFederations.push(FEDERATION_NAMES[6]);

    return {
      federationRepresentations,
      attendedRepresentations: attended,
      gatedRepresentations,
      consensusGates,
      activeFederations,
      consensusScore,
      consensusApproved,
      outputLatent,
      attentionWeights: attentionWeights.weights,
      gateContributions,
      vetoFederations,
    };
  }

  private crossFederationAttention(federationRepresentations: Float64Array[]): {
    attended: Float64Array[];
    weights: number[][][];
  } {
    const numFederations = FEDERATION_NAMES.length;
    const projections: Array<{
      q: Float64Array;
      k: Float64Array;
      v: Float64Array;
    }> = [];
    for (const representation of federationRepresentations) {
      projections.push({
        q: linearForward(representation, this.wQ),
        k: linearForward(representation, this.wK),
        v: linearForward(representation, this.wV),
      });
    }

    const weights: number[][][] = [];
    const headOutputs = new Array<Float64Array[]>(this.heads);
    for (let head = 0; head < this.heads; head += 1) {
      const qHead = new Float64Array(numFederations * this.headDim);
      const kHead = new Float64Array(numFederations * this.headDim);
      const vHead = new Float64Array(numFederations * this.headDim);
      for (let rowIndex = 0; rowIndex < numFederations; rowIndex += 1) {
        const projection = projections[rowIndex] as {
          q: Float64Array;
          k: Float64Array;
          v: Float64Array;
        };
        const headOffset = head * this.headDim;
        for (let dimIndex = 0; dimIndex < this.headDim; dimIndex += 1) {
          qHead[rowIndex * this.headDim + dimIndex] = projection.q[headOffset + dimIndex] as number;
          kHead[rowIndex * this.headDim + dimIndex] = projection.k[headOffset + dimIndex] as number;
          vHead[rowIndex * this.headDim + dimIndex] = projection.v[headOffset + dimIndex] as number;
        }
      }
      const scale = Math.sqrt(this.headDim);
      const scores = matmul(
        qHead,
        transpose(kHead, numFederations, this.headDim),
        numFederations,
        this.headDim,
        numFederations,
      );
      const headWeights: number[][] = [];
      for (let row = 0; row < numFederations; row += 1) {
        const rowVector = scores.subarray(row * numFederations, (row + 1) * numFederations);
        const scaled = new Float64Array(numFederations);
        for (let col = 0; col < numFederations; col += 1) {
          scaled[col] = (rowVector[col] as number) / scale;
        }
        headWeights.push(Array.from(softmaxRow(scaled)));
      }
      weights.push(headWeights);
      const outHead = new Float64Array(numFederations * this.headDim);
      for (let row = 0; row < numFederations; row += 1) {
        for (let dimIndex = 0; dimIndex < this.headDim; dimIndex += 1) {
          let sum = 0;
          for (let col = 0; col < numFederations; col += 1) {
            sum +=
              ((headWeights[row] as number[])[col] as number) *
              (vHead[col * this.headDim + dimIndex] as number);
          }
          outHead[row * this.headDim + dimIndex] = sum;
        }
      }
      headOutputs[head] = Array.from({ length: numFederations }, (_, row) =>
        outHead.subarray(row * this.headDim, (row + 1) * this.headDim),
      ) as Float64Array[];
    }

    const attended: Float64Array[] = [];
    for (let row = 0; row < numFederations; row += 1) {
      const concatenated = new Float64Array(this.fedDim);
      for (let head = 0; head < this.heads; head += 1) {
        const headOutput = (headOutputs[head] as Float64Array[])[row] as Float64Array;
        const offset = head * this.headDim;
        for (let dimIndex = 0; dimIndex < this.headDim; dimIndex += 1) {
          concatenated[offset + dimIndex] = headOutput[dimIndex] as number;
        }
      }
      attended.push(linearForward(concatenated, this.wO));
    }
    return { attended, weights };
  }

  mathematicalFormulation(): string {
    return [
      "\\mathbf{h}_f = \\mathbf{W}_3^{(f)}\\;\\text{GELU}(\\mathbf{W}_2^{(f)}\\;\\text{GELU}(\\mathbf{W}_1^{(f)}\\mathbf{z} + \\mathbf{b}_1^{(f)}) + \\mathbf{b}_2^{(f)}) + \\mathbf{b}_3^{(f)}",
      "\\text{MultiHead}(Q,K,V) = \\text{Concat}(\\text{head}_1,\\dots,\\text{head}_h)\\mathbf{W}_O",
      "\\text{head}_i = \\text{softmax}\\left(\\frac{QK^T}{\\sqrt{d_k}}\\right)V",
      "\\mathbf{g} = \\sigma(\\text{MLP}_{\\text{gate}}(\\text{flatten}(\\mathbf{H}_{\\text{attended}})))",
      "\\text{consensus} = \\mathbb{I}\\left(\\frac{1}{7}\\sum_{f=1}^7 g_f > 0.7\\right)",
      "\\mathbf{z}_{\\text{out}} = \\mathbf{W}_{\\text{out}}\\;\\text{GELU}\\left(\\sum_{f=1}^7 \\frac{g_f}{\\sum_j g_j}\\,\\mathbf{h}_{\\text{gated}}^{(f)}\\right)",
    ].join("\n");
  }
}

function geluVector(vector: Float64Array): Float64Array {
  const out = new Float64Array(vector.length);
  for (let index = 0; index < vector.length; index += 1) {
    out[index] = gelu(vector[index] as number);
  }
  return out;
}

function scalarMultiplyVector(vector: Float64Array, scalar: number): Float64Array {
  const out = new Float64Array(vector.length);
  for (let index = 0; index < vector.length; index += 1) {
    out[index] = (vector[index] as number) * scalar;
  }
  return out;
}

function transpose(matrix: Float64Array, rows: number, cols: number): Float64Array {
  const out = new Float64Array(rows * cols);
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      out[col * rows + row] = matrix[row * cols + col] as number;
    }
  }
  return out;
}

function fedDimValues(vectors: Float64Array[]): Array<number> {
  const values: number[] = [];
  for (const vector of vectors) {
    for (let index = 0; index < vector.length; index += 1) {
      values.push(vector[index] as number);
    }
  }
  return values;
}
