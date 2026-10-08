/**
 * Science Integrity — Runtime por defecto (src/lib/science-integrity/runtime.ts)
 * -----------------------------------------------------------------------------
 * Ensambla los servicios nativos REALES del puente Fase B en una singleton
 * (mismo patrón de `sharedCache` en hypercore-routes): ledger encadenado en
 * memoria, registro Genesis IGDS, firma Ed25519 por software y store de sellos.
 *
 * TSA no se cablea por defecto (no hay autoridad temporal externa): el sello usa
 * el perfil `restricted` (verificación offline) en lugar de `public-verifiable`.
 */
import { createEd25519Signer, generateEd25519KeyPair, type SealSigner } from "../igds/keys";
import { createGenesisRegistry, type GenesisRegistry } from "../igds/registry";
import type { TsaClient } from "../igds/tsa";
import { NCUAAcademicPipeline } from "../ncua/academic-pipeline";
import { InMemoryScienceIntegrityStore, ScienceIntegrityLedger } from "./ledger";
import { InMemoryCertificateStore, type CertificateStore } from "./certification";

export interface ScienceIntegrityServices {
  ledger: ScienceIntegrityLedger;
  registry: GenesisRegistry;
  signer: SealSigner;
  certificateStore: CertificateStore;
  tsa: TsaClient | null;
  ncua: NCUAAcademicPipeline;
}

export function createDefaultScienceIntegrityServices(): ScienceIntegrityServices {
  const { privateKeyPem } = generateEd25519KeyPair();
  const signer = createEd25519Signer({ privateKeyPem, keyId: "science-integrity-issuer-001" });
  return {
    ledger: new ScienceIntegrityLedger(new InMemoryScienceIntegrityStore()),
    registry: createGenesisRegistry(),
    signer,
    certificateStore: new InMemoryCertificateStore(),
    tsa: null,
    ncua: new NCUAAcademicPipeline(),
  };
}

export const defaultScienceIntegrityServices: ScienceIntegrityServices =
  createDefaultScienceIntegrityServices();