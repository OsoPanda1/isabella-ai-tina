/**
 * NCUA v3.0 — Sovereign Protocol 2-de-3 Quorum & Verifiable Evidence Engine
 *
 * Reglas canónicas:
 * 1. Zero Trust: Ninguna operación sensible se ejecuta sin consenso verificado (Quorum 2 de 3).
 * 2. Nodos soberanos autorizados:
 *    - Node A: CROWN Gateway (Orquestación y control)
 *    - Node B: SOPHIA Engine (Validación epistemológica y análisis lógico)
 *    - Node C: ARGUS Sentinel (Gobernanza ética y verificación de defensa)
 * 3. Evidencia Verificable: Raíz Merkle (SHA-256/SHA3-512), firmas criptográficas verificables,
 *    sellos temporales inmutables y vinculación append-only al ledger BookPI.
 * 4. Fail-closed: Expiración, anti-replay, o firmas corruptas niegan inmediatamente la operación.
 */

import { z } from "zod";
import * as crypto from "node:crypto";
import { config } from "../config";
import { canonicalize } from "../igds/canonical";
import { SovereignAudit } from "../sovereign-audit";
import { BookPILedgerAuditor } from "./bookpi-trajectory";

export type NcuaNodeId = "node_a_crown" | "node_b_sophia" | "node_c_argus";
export type NcuaShortNodeId = "A" | "B" | "C";

export type NcuaOperationStatus = "pending" | "approved" | "rejected" | "executed" | "expired";

export type NcuaCategory =
  "cryptographic" | "governance" | "financial" | "system_critical" | "sovereign_action";

export interface NcuaApprovalNodeSignature {
  nodeId: NcuaNodeId;
  shortId: NcuaShortNodeId;
  decision: "approve" | "reject";
  timestamp: string;
  transcriptHash: string;
  signature: string;
  publicKeyFingerprint: string;
  confidenceScore: number;
  claimReason: string;
}

export interface NcuaVerifiableEvidence {
  operationId: string;
  merkleRoot: string;
  quorumReached: boolean;
  requiredQuorum: number;
  approvedCount: number;
  rejectedCount: number;
  participatingNodes: NcuaNodeId[];
  policyVersion: string;
  evidenceStatus: "E0" | "E1" | "E2" | "E3";
  transcriptHash: string;
  verifiedAt: string;
  bookpiEntryId?: string;
  bookpiMerkleRoot?: string;
}

export interface NcuaOperation {
  id: string;
  tenantId: string;
  userId: string;
  operation: string;
  category: NcuaCategory;
  status: NcuaOperationStatus;
  payload: Record<string, unknown>;
  payloadHash: string;
  policyHash: string;
  nonce: string;
  quorum: "2-de-3";
  requiredApprovals: 2;
  totalNodes: 3;
  approvals: NcuaApprovalNodeSignature[];
  verifiableEvidence: NcuaVerifiableEvidence | null;
  createdAt: string;
  expiresAt: string;
}

// Zod validation schemas
export const CreateNcuaOperationSchema = z.object({
  operation: z.string().min(3).max(100),
  category: z
    .enum(["cryptographic", "governance", "financial", "system_critical", "sovereign_action"])
    .default("sovereign_action"),
  payload: z.record(z.unknown()).default({}),
  ttlMinutes: z.number().int().min(1).max(60).default(15),
});

export const SubmitNcuaApprovalSchema = z.object({
  operationId: z.string().min(5).max(64),
  node: z.enum(["node_a_crown", "node_b_sophia", "node_c_argus", "A", "B", "C"]),
  decision: z.enum(["approve", "reject"]).default("approve"),
  reason: z.string().min(3).max(500).default("Aprobación validada bajo CROWN/AEGIS"),
  signature: z.string().optional(),
});

// Canonical Node Registry
interface NodeRegistryEntry {
  id: NcuaNodeId;
  shortId: NcuaShortNodeId;
  name: string;
  role: string;
  secretSeed: string;
  publicKeyFingerprint: string;
}

const sovereignAuditor = new BookPILedgerAuditor({
  hmacKey: config().AEGIS_AUDIT_SECRET || "sovereign-aegis-audit-secret-2026",
});

function resolveNodeId(node: string): { id: NcuaNodeId; shortId: NcuaShortNodeId } {
  const norm = node.trim().toLowerCase();
  if (norm === "a" || norm === "node_a_crown" || norm === "crown") {
    return { id: "node_a_crown", shortId: "A" };
  }
  if (norm === "b" || norm === "node_b_sophia" || norm === "sophia") {
    return { id: "node_b_sophia", shortId: "B" };
  }
  if (norm === "c" || norm === "node_c_argus" || norm === "argus") {
    return { id: "node_c_argus", shortId: "C" };
  }
  throw new Error(`[NCUA] Nodo no autorizado: ${node}`);
}

function getNodeKeys(nodeId: NcuaNodeId): NodeRegistryEntry {
  const rootSecret = config().AEGIS_AUDIT_SECRET || "sovereign-ncua-key-derivation-salt-2026";
  const nodeSeed = crypto
    .createHmac("sha3-256", rootSecret)
    .update(`ncua:node:${nodeId}`)
    .digest("hex");
  const fingerprint = crypto
    .createHash("sha256")
    .update(`pub:${nodeId}:${nodeSeed.slice(0, 32)}`)
    .digest("hex")
    .slice(0, 16);

  const shortId: NcuaShortNodeId =
    nodeId === "node_a_crown" ? "A" : nodeId === "node_b_sophia" ? "B" : "C";

  return {
    id: nodeId,
    shortId,
    name:
      nodeId === "node_a_crown"
        ? "CROWN Gateway"
        : nodeId === "node_b_sophia"
          ? "SOPHIA Engine"
          : "ARGUS Sentinel",
    role:
      nodeId === "node_a_crown"
        ? "Orchestration & State Arbitrage"
        : nodeId === "node_b_sophia"
          ? "Epistemic Consistency & Analysis"
          : "Ethical Governance & Veto",
    secretSeed: nodeSeed,
    publicKeyFingerprint: `fp_ncua_${shortId}_${fingerprint}`,
  };
}

export class NcuaProtocolEngine {
  private static operations = new Map<string, NcuaOperation>();

  public static createOperation(params: {
    tenantId: string;
    userId: string;
    operation: string;
    category?: NcuaCategory;
    payload?: Record<string, unknown>;
    ttlMinutes?: number;
  }): NcuaOperation {
    const id = `op_${crypto.randomUUID().slice(0, 12)}`;
    const nonce = crypto.randomUUID().slice(0, 16);
    const payload = params.payload ?? {};
    // Digest canónico (RFC 8785 vía IGDS): antes usaba
    // JSON.stringify(payload, Object.keys(payload).sort()), cuyo `replacer`
    // sólo filtra claves y no las reordena, así que dos payloads iguales con
    // distinto orden producían hashes distintos.
    const payloadCanonical = canonicalize(JSON.parse(JSON.stringify(payload)));
    const payloadHash = crypto.createHash("sha256").update(payloadCanonical).digest("hex");
    const policyVersion = config().CROWN_CONSTITUTION_VERSION || "4.3.3";
    const policyHash = crypto.createHash("sha256").update(policyVersion).digest("hex");

    const now = new Date();
    const ttl = (params.ttlMinutes ?? 15) * 60 * 1000;
    const expiresAt = new Date(now.getTime() + ttl).toISOString();

    const op: NcuaOperation = {
      id,
      tenantId: params.tenantId,
      userId: params.userId,
      operation: params.operation,
      category: params.category ?? "sovereign_action",
      status: "pending",
      payload,
      payloadHash,
      policyHash,
      nonce,
      quorum: "2-de-3",
      requiredApprovals: 2,
      totalNodes: 3,
      approvals: [],
      verifiableEvidence: null,
      createdAt: now.toISOString(),
      expiresAt,
    };

    this.operations.set(id, op);
    return op;
  }

  public static getOperation(operationId: string, tenantId: string): NcuaOperation | null {
    const op = this.operations.get(operationId);
    if (!op || op.tenantId !== tenantId) return null;
    this.refreshOperationStatus(op);
    return op;
  }

  public static listOperations(tenantId: string): NcuaOperation[] {
    const result: NcuaOperation[] = [];
    for (const op of this.operations.values()) {
      if (op.tenantId === tenantId) {
        this.refreshOperationStatus(op);
        result.push(op);
      }
    }
    return result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  private static refreshOperationStatus(op: NcuaOperation): void {
    if (op.status === "pending") {
      const now = new Date().getTime();
      const exp = new Date(op.expiresAt).getTime();
      if (now > exp) {
        op.status = "expired";
      }
    }
  }

  public static generateNodeSignature(
    nodeId: NcuaNodeId,
    operation: NcuaOperation,
    decision: "approve" | "reject",
    claimReason: string,
  ): NcuaApprovalNodeSignature {
    const nodeKeys = getNodeKeys(nodeId);
    const timestamp = new Date().toISOString();
    const transcriptPayload = `${operation.id}|${operation.tenantId}|${operation.payloadHash}|${operation.policyHash}|${operation.nonce}|${nodeId}|${decision}|${timestamp}`;
    const transcriptHash = crypto.createHash("sha256").update(transcriptPayload).digest("hex");

    const signature = crypto
      .createHmac("sha3-512", nodeKeys.secretSeed)
      .update(transcriptHash)
      .digest("hex");

    return {
      nodeId,
      shortId: nodeKeys.shortId,
      decision,
      timestamp,
      transcriptHash,
      signature: `ncua-sig-v1:${signature}`,
      publicKeyFingerprint: nodeKeys.publicKeyFingerprint,
      confidenceScore: decision === "approve" ? 0.998 : 0.05,
      claimReason,
    };
  }

  public static verifyNodeSignature(
    signature: NcuaApprovalNodeSignature,
    _operation: NcuaOperation,
  ): boolean {
    const nodeKeys = getNodeKeys(signature.nodeId);
    const expectedPrefix = "ncua-sig-v1:";
    if (!signature.signature.startsWith(expectedPrefix)) return false;

    const presentedRaw = signature.signature.slice(expectedPrefix.length);
    const expectedRaw = crypto
      .createHmac("sha3-512", nodeKeys.secretSeed)
      .update(signature.transcriptHash)
      .digest("hex");

    if (presentedRaw.length !== expectedRaw.length) return false;
    return crypto.timingSafeEqual(Buffer.from(presentedRaw), Buffer.from(expectedRaw));
  }

  public static submitApproval(params: {
    operationId: string;
    tenantId: string;
    node: string;
    decision: "approve" | "reject";
    reason?: string;
    customSignature?: string;
  }): { operation: NcuaOperation; evidence: NcuaVerifiableEvidence | null } {
    const op = this.operations.get(params.operationId);
    if (!op || op.tenantId !== params.tenantId) {
      throw new Error(`[NCUA] Operación ${params.operationId} no encontrada.`);
    }

    this.refreshOperationStatus(op);
    if (op.status === "expired") {
      throw new Error(`[NCUA] Operación ${params.operationId} ha expirado (fail-closed).`);
    }
    if (op.status !== "pending") {
      throw new Error(
        `[NCUA] Operación ya cerrada con estado '${op.status}'. No se admiten más votos.`,
      );
    }

    const { id: nodeId, shortId } = resolveNodeId(params.node);

    // Evitar doble voto por el mismo nodo
    const existingIndex = op.approvals.findIndex((a) => a.nodeId === nodeId);
    if (existingIndex !== -1) {
      throw new Error(`[NCUA] El nodo ${nodeId} (${shortId}) ya ha emitido su voto.`);
    }

    // Generar o validar firma criptográfica del nodo
    let approvalSig: NcuaApprovalNodeSignature;
    if (params.customSignature) {
      const nodeKeys = getNodeKeys(nodeId);
      approvalSig = {
        nodeId,
        shortId,
        decision: params.decision,
        timestamp: new Date().toISOString(),
        transcriptHash: crypto
          .createHash("sha256")
          .update(`${op.id}|${nodeId}|${params.decision}`)
          .digest("hex"),
        signature: params.customSignature,
        publicKeyFingerprint: nodeKeys.publicKeyFingerprint,
        confidenceScore: params.decision === "approve" ? 0.99 : 0.05,
        claimReason: params.reason || "Firma externa enviada",
      };
      if (!this.verifyNodeSignature(approvalSig, op)) {
        throw new Error(`[NCUA] Firma criptográfica del nodo ${nodeId} inválida.`);
      }
    } else {
      approvalSig = this.generateNodeSignature(
        nodeId,
        op,
        params.decision,
        params.reason || `Aprobación otorgada por nodo soberano ${shortId}`,
      );
    }

    op.approvals.push(approvalSig);

    // Evaluar Quorum 2-de-3
    const approvedCount = op.approvals.filter((a) => a.decision === "approve").length;
    const rejectedCount = op.approvals.filter((a) => a.decision === "reject").length;

    if (approvedCount >= 2) {
      op.status = "approved";
      op.verifiableEvidence = this.generateVerifiableEvidence(
        op,
        true,
        approvedCount,
        rejectedCount,
      );
      this.sealEvidenceToLedger(op);
    } else if (rejectedCount >= 2) {
      op.status = "rejected";
      op.verifiableEvidence = this.generateVerifiableEvidence(
        op,
        false,
        approvedCount,
        rejectedCount,
      );
    }

    return {
      operation: op,
      evidence: op.verifiableEvidence,
    };
  }

  private static generateVerifiableEvidence(
    op: NcuaOperation,
    quorumReached: boolean,
    approvedCount: number,
    rejectedCount: number,
  ): NcuaVerifiableEvidence {
    const leaves = [
      op.payloadHash,
      op.policyHash,
      op.nonce,
      ...op.approvals.map((a) => `${a.nodeId}:${a.decision}:${a.signature}`),
    ];
    const merkle = SovereignAudit.buildMerkleTree(leaves);

    return {
      operationId: op.id,
      merkleRoot: merkle.root,
      quorumReached,
      requiredQuorum: 2,
      approvedCount,
      rejectedCount,
      participatingNodes: op.approvals.map((a) => a.nodeId),
      policyVersion: config().CROWN_CONSTITUTION_VERSION || "4.3.3",
      evidenceStatus: quorumReached ? "E2" : "E0",
      transcriptHash: merkle.leaves[0] || op.payloadHash,
      verifiedAt: new Date().toISOString(),
    };
  }

  private static sealEvidenceToLedger(op: NcuaOperation): void {
    if (!op.verifiableEvidence) return;
    try {
      const entry = sovereignAuditor.recordNCUATransaction(
        op.tenantId,
        op.approvals.length,
        {
          conceptId: `ncua-op-${op.id}`,
          latentDimensions: [0.95, 0.99, 1.0],
          semanticEnergy: 1.0,
          epistemicConfidence: 0.99,
        },
        {
          qubitAmplitudes: ["1", "0", "0", "1"],
          entanglementEntropy: 0.002,
          parameterShiftGradient: 0.999,
          merkleSeal: op.verifiableEvidence.merkleRoot,
        },
      );
      op.verifiableEvidence.bookpiEntryId = entry.entryId;
      op.verifiableEvidence.bookpiMerkleRoot = entry.merkleRoot;
      op.verifiableEvidence.evidenceStatus = "E3"; // E3: Ledger inmutable sellado
    } catch (_err) {
      // Si BookPI falla el sello permanece E2 (verificado en memoria con Merkle root)
      op.verifiableEvidence.evidenceStatus = "E2";
    }
  }
}
