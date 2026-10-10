import { describe, expect, it } from "vitest";
import {
  buildTimestampToken,
  createEd25519Signer,
  createGenesisRegistry,
  createImprintOnlyTsaVerifier,
  generateEd25519KeyPair,
  type TsaClient,
} from "@/lib/igds";
import {
  checkpointWithService,
  revokeWithService,
  sealWithService,
  verifyWithService,
  type IgdsServiceDeps,
} from "@/lib/igds-service";

const signer = createEd25519Signer({
  privateKeyPem: generateEd25519KeyPair().privateKeyPem,
  keyId: "svc-ed25519-1",
});

const fixedTime = "2026-09-17T20:03:11Z";
const tsa: TsaClient = {
  timestamp: (digestValue) =>
    Promise.resolve(buildTimestampToken({ digestValue, generatedAt: fixedTime })),
};

function deps(overrides: Partial<IgdsServiceDeps> = {}): IgdsServiceDeps {
  return {
    signer,
    registry: createGenesisRegistry(),
    tsa,
    tsaVerifier: createImprintOnlyTsaVerifier(),
    now: () => new Date(fixedTime),
    ...overrides,
  };
}

const sealInput = {
  documentId: "doc-svc-1",
  content: "informe gobernado",
  profile: "public-verifiable" as const,
  document: { title: "Informe", mime_type: "text/plain", language: "es-MX" },
  generation: {
    system: "Isabella",
    skill: "document-seal",
    declaration: {
      ai_generated: true,
      ai_assisted: true,
      human_modified: false,
      human_reviewed: true,
    },
  },
  actions: [{ action: "created", when: fixedTime } as const],
};

describe("IGDS servicio de sellado", () => {
  it("sella y verifica sin revocaciones", async () => {
    const service = deps();
    const pkg = await sealWithService(sealInput, service);
    const report = await verifyWithService(pkg, service, { content: "informe gobernado" });
    expect(report.document_status).toBe("valid");
    expect(report.genesis.included).toBe(true);
    expect(report.current_key_status).toBe("valid");
  });

  it("resuelve valid_at_signing_time cuando la revocación es posterior", async () => {
    const service = deps({
      revocationLookup: async (keyId) =>
        keyId === "svc-ed25519-1"
          ? { effective_at: "2026-10-01T00:00:00Z", scope: "all_signatures_after_effective_at" }
          : null,
    });
    const pkg = await sealWithService(sealInput, service);
    const report = await verifyWithService(pkg, service);
    expect(report.document_status).toBe("valid_at_signing_time");
    expect(report.current_key_status).toBe("revoked");
  });

  it("resuelve revoked_before_signing cuando la revocación precede la firma", async () => {
    const service = deps({
      revocationLookup: async () => ({
        effective_at: "2026-09-01T00:00:00Z",
        scope: "all_signatures_after_effective_at",
      }),
    });
    const pkg = await sealWithService(sealInput, service);
    const report = await verifyWithService(pkg, service);
    expect(report.document_status).toBe("revoked_before_signing");
  });

  it("registra revocaciones firmadas y construye checkpoints", async () => {
    const service = deps();
    await sealWithService(sealInput, service);
    const entry = await revokeWithService(
      {
        revocationId: "rev-svc-1",
        targetType: "signing_key",
        targetId: "svc-ed25519-1",
        reason: "key_compromise",
        issuedBy: "genesis-authority",
        effectiveAt: "2026-10-01T00:00:00Z",
      },
      service,
    );
    expect(entry.type).toBe("revocation");
    expect(entry.sequence).toBe(1);

    const checkpoint = await checkpointWithService(service);
    expect(checkpoint?.tree_size).toBe(2);
    expect(checkpoint?.root_hash).toHaveLength(64);
  });
});
