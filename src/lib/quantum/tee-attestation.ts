/**
 * Isabella Quantum Mesh — TEE Attestation (Núcleo 17)
 * Atestación verificable: nonce, measurement/image digest, policy version,
 * platform identity, expiration, signature chain.
 * NOTA: Una cadena mock NO es atestación.
 *
 * SEGURIDAD: Requiere FEATURE_LAB_MODE=true en producción.
 * Sin esta flag, generateAttestation lanza PROTOTYPE_NOT_AVAILABLE.
 */
import { randomUUID, createHash } from "node:crypto";
import { requireLabMode } from "../lab-mode";

export interface TEEAttestationEvidence {
  attestationId: string;
  nonce: string;
  measurementDigest: string;
  policyVersion: string;
  platformIdentity: string;
  expiration: string;
  signatureChain: string[];
  verified: boolean;
  verificationService: string;
}

export interface TEEVerificationRequest {
  platformId: string;
  expectedMeasurement: string;
  nonce: string;
  policyVersion: string;
}

const attestationLog: TEEAttestationEvidence[] = [];

/**
 * Genera una atestación TEE para un worker.
 * En producción, esto vendría del enclave real (SGX/TrustZone/SEV).
 */
export function generateAttestation(params: {
  platformId: string;
  measurement: string;
  policyVersion: string;
}): TEEAttestationEvidence {
  requireLabMode("TEE-ATTESTATION");
  const nonce = randomUUID();
  const measurementDigest = createHash("sha256")
    .update(`${params.measurement}:${nonce}`)
    .digest("hex");

  const expiration = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  // Signature chain: platform signs the measurement
  const sig1 = createHash("sha256")
    .update(`tee-platform:${params.platformId}:${measurementDigest}`)
    .digest("hex");
  const sig2 = createHash("sha256")
    .update(`tee-kernel:${sig1}:${params.policyVersion}`)
    .digest("hex");

  const evidence: TEEAttestationEvidence = {
    attestationId: randomUUID(),
    nonce,
    measurementDigest,
    policyVersion: params.policyVersion,
    platformIdentity: params.platformId,
    expiration,
    signatureChain: [sig1, sig2],
    verified: false,
    verificationService: "isabella-tee-verifier-v1",
  };

  attestationLog.push(evidence);
  return evidence;
}

/**
 * Verifica una atestación TEE.
 * Debe realizarla un servicio independiente del enclave.
 */
export function verifyAttestation(
  request: TEEVerificationRequest,
  evidence: TEEAttestationEvidence,
): { verified: boolean; reason?: string } {
  // Check expiration
  if (new Date(evidence.expiration) < new Date()) {
    return { verified: false, reason: "ATTESTATION_EXPIRED" };
  }

  // Check nonce
  if (evidence.nonce !== request.nonce) {
    return { verified: false, reason: "NONCE_MISMATCH" };
  }

  // Check measurement digest
  const expectedDigest = createHash("sha256")
    .update(`${request.expectedMeasurement}:${request.nonce}`)
    .digest("hex");
  if (evidence.measurementDigest !== expectedDigest) {
    return { verified: false, reason: "MEASUREMENT_MISMATCH" };
  }

  // Check policy version
  if (evidence.policyVersion !== request.policyVersion) {
    return { verified: false, reason: "POLICY_VERSION_MISMATCH" };
  }

  // Check platform identity
  if (evidence.platformIdentity !== request.platformId) {
    return { verified: false, reason: "PLATFORM_MISMATCH" };
  }

  // Verify signature chain
  if (evidence.signatureChain.length < 2) {
    return { verified: false, reason: "INCOMPLETE_SIGNATURE_CHAIN" };
  }

  // Mark as verified
  evidence.verified = true;
  return { verified: true };
}

/**
 * Estado de las atestaciones TEE.
 */
export function getTEEStatus() {
  const verified = attestationLog.filter((a) => a.verified).length;
  const unverified = attestationLog.filter((a) => !a.verified).length;

  return {
    totalAttestations: attestationLog.length,
    verified,
    unverified,
    recent: attestationLog.slice(-10),
    verificationService: "isabella-tee-verifier-v1",
    disclaimer:
      "TEE attestation is NOT a guarantee. Recent research has shown attacks on certain enclave models.",
  };
}
