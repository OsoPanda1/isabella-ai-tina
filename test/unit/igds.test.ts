import { describe, expect, it } from "vitest";
import {
  buildConsistencyProof,
  buildGenesisCheckpoint,
  buildInclusionProof,
  buildManifest,
  buildTimestampToken,
  canonicalize,
  computeEntryHash,
  createGenesisRegistry,
  createRevocationPayload,
  createEd25519Signer,
  digestHex,
  evaluateTrust,
  generateEd25519KeyPair,
  hashLeaf,
  isGenesisEntryBound,
  manifestClaimDigest,
  manifestFinalDigest,
  merkleRoot,
  registerPqcProvider,
  sealDocument,
  shortSealId,
  signDigest,
  verifyConsistencyProof,
  verifyEd25519,
  verifyGenesisChain,
  verifyInclusionProof,
  verifySealPackage,
  verifySignatureEnvelope,
  type PqcProvider,
  type SealDocumentInput,
  type TsaClient,
} from "@/lib/igds";

const signer = (() => {
  const { privateKeyPem } = generateEd25519KeyPair();
  return createEd25519Signer({ privateKeyPem, keyId: "test-ed25519-1" });
})();

const document = {
  title: "Informe sellado",
  mime_type: "application/pdf",
  language: "es-MX",
  page_count: 3,
};
const generation = {
  system: "Isabella",
  skill: "document-seal",
  declaration: {
    ai_generated: true,
    ai_assisted: true,
    human_modified: false,
    human_reviewed: true,
  },
};

const dynamicTsa: TsaClient = {
  timestamp: (digestValue) => Promise.resolve(buildTimestampToken({ digestValue })),
};

const tsaVerifier = {
  verify: (token: { message_imprint: { value: string } }, digestValue: string) =>
    Promise.resolve(token.message_imprint.value === digestValue),
};

describe("IGDS canonicalización JCS", () => {
  it("ordena claves y es determinista", () => {
    const left = canonicalize({ b: 1, a: { d: 2, c: [3, { z: 1 }] } });
    const right = canonicalize({ a: { c: [3, { z: 1 }], d: 2 }, b: 1 });
    expect(left).toBe(right);
    expect(left).toBe('{"a":{"c":[3,{"z":1}],"d":2},"b":1}');
  });

  it("rechaza valores no serializables", () => {
    expect(() => canonicalize({ bad: Number.NaN })).toThrow();
    expect(() => canonicalize({ bad: new Date() })).toThrow();
    expect(() => canonicalize({ bad: undefined })).not.toThrow();
    expect(canonicalize({ bad: undefined })).toBe("{}");
  });
});

describe("IGDS digests y Merkle", () => {
  it("calcula SHA-256 estable", () => {
    expect(digestHex("sha256", "isabella")).toHaveLength(64);
    expect(digestHex("sha256", "isabella")).toBe(digestHex("sha256", "isabella"));
  });

  it("prueba de inclusión válida y alterada", () => {
    const leaves = ["a", "b", "c", "d", "e"].map((value) => hashLeaf(value));
    const proof = buildInclusionProof(leaves, 2);
    expect(verifyInclusionProof(proof)).toBe(true);
    expect(verifyInclusionProof({ ...proof, leaf_hash: hashLeaf("x") })).toBe(false);
    expect(merkleRoot(leaves)).toBe(proof.root_hash);
  });

  it("prueba de consistencia (solo crece) y detecta rollback", () => {
    const base = ["a", "b", "c"].map((value) => hashLeaf(value));
    const grown = [...base, hashLeaf("d"), hashLeaf("e")];
    const proof = buildConsistencyProof(base, grown);
    expect(verifyConsistencyProof(proof)).toBe(true);
    expect(verifyConsistencyProof({ ...proof, new_root: hashLeaf("tampered") })).toBe(false);

    expect(() => buildConsistencyProof(grown, base)).toThrow();
    const forked = [hashLeaf("x"), ...grown.slice(1)];
    expect(() => buildConsistencyProof(base, forked)).toThrow();
  });
});

describe("IGDS firmas Ed25519", () => {
  it("firma y verifica; rechaza manipulación", () => {
    const digest = digestHex("sha256", "contenido");
    const envelope = signDigest(signer, digest);
    expect(verifySignatureEnvelope(envelope, digest)).toBe(true);
    expect(verifySignatureEnvelope(envelope, digestHex("sha256", "otro"))).toBe(false);
    expect(verifySignatureEnvelope({ ...envelope, value: "AAAA" }, digest)).toBe(false);
    expect(verifyEd25519(signer.publicKey, Buffer.from(digest), Buffer.from("00", "hex"))).toBe(
      false,
    );
  });
});

describe("IGDS manifiesto", () => {
  it("construye y valida; el digest base difiere del final solo por el timestamp", () => {
    const manifest = buildManifest({
      documentId: "doc-001",
      profile: "public-verifiable",
      contentDigest: { algorithm: "sha256", value: digestHex("sha256", "hola") },
      document,
      generation,
      actions: [{ action: "created", when: "2026-09-17T20:00:00Z" }],
      createdAt: "2026-09-17T20:03:11Z",
    });
    const base = manifestClaimDigest(manifest);
    const withTs = { ...manifest, timestamp: buildTimestampToken({ digestValue: base }) };
    const final = manifestFinalDigest(withTs);
    expect(base).not.toBe(final);
    expect(manifestFinalDigest({ ...withTs, signatures: [] })).toBe(final);
  });
});

describe("IGDS registro Genesis", () => {
  it("encadena entradas y detecta alteración", async () => {
    const registry = createGenesisRegistry();
    const contentDigest = digestHex("sha256", "doc");
    const manifestDigest = digestHex("sha256", "manifest");
    const entry = await registry.appendSeal({
      documentId: "doc-001",
      documentDigest: `sha256:${contentDigest}`,
      manifestDigest: `sha256:${manifestDigest}`,
      signature: signDigest(signer, manifestDigest),
      createdAt: "2026-09-17T20:03:11Z",
    });
    expect(entry.sequence).toBe(0);
    expect(entry.previous_entry_hash).toBe("0".repeat(64));
    expect(computeEntryHash(entry)).toBe(entry.entry_hash);

    const chain = await registry.list();
    expect(verifyGenesisChain(chain).success).toBe(true);
    expect(verifyGenesisChain([{ ...entry, document_id: "hacked" }]).success).toBe(false);
  });

  it("registra revocaciones sin borrar nada", async () => {
    const registry = createGenesisRegistry();
    const revocation = createRevocationPayload({
      revocationId: "rev-2026-0041",
      targetType: "signing_key",
      targetId: "test-ed25519-1",
      reason: "key_compromise",
      issuedBy: "isabella-genesis-authority",
      effectiveAt: "2026-10-01T10:00:00Z",
    });
    const payloadHash = computeEntryHash({
      sequence: 0,
      entry_id: "gen-rev-1",
      type: "revocation",
      document_id: revocation.target_id,
      document_digest: "",
      manifest_digest: "",
      previous_entry_hash: "0".repeat(64),
      created_at: "2026-10-01T10:00:00Z",
      revocation,
    });
    const entry = await registry.appendRevocation({
      entryId: "gen-rev-1",
      revocation,
      signature: signDigest(signer, payloadHash),
      createdAt: "2026-10-01T10:00:00Z",
    });
    expect(entry.type).toBe("revocation");
    expect(entry.entry_hash).toBe(payloadHash);
    expect(entry.revocation?.reason).toBe("key_compromise");
  });

  it("construye checkpoint firmado", async () => {
    const registry = createGenesisRegistry();
    await registry.appendSeal({
      documentId: "doc-001",
      documentDigest: "sha256:aa",
      manifestDigest: "sha256:bb",
      signature: signDigest(signer, "bb"),
    });
    const checkpoint = await buildGenesisCheckpoint({ registry, signer });
    expect(checkpoint).not.toBeNull();
    expect(checkpoint!.tree_size).toBe(1);
    expect(checkpoint!.signature.algorithm).toBe("Ed25519");
  });
});

describe("IGDS sellado y verificación offline", () => {
  it("sella el perfil public-verifiable y lo verifica", async () => {
    const registry = createGenesisRegistry();
    const pkg = await sealDocument(
      {
        documentId: "doc-100",
        content: "contenido del informe",
        profile: "public-verifiable",
        document,
        generation,
        actions: [
          { action: "created", when: "2026-09-17T20:00:00Z" },
          { action: "sealed", when: "2026-09-17T20:03:11Z" },
        ],
      },
      { signer, registry, tsa: dynamicTsa, now: () => new Date("2026-09-17T20:03:11Z") },
    );

    expect(pkg.seal.seal_id).toHaveLength(12);
    expect(pkg.seal.signature_algorithms).toEqual(["Ed25519"]);
    expect(isGenesisEntryBound(pkg)).toBe(true);

    const report = await verifySealPackage(pkg, {
      content: "contenido del informe",
      tsaVerifier,
      trustedPublicKeys: { [signer.keyId]: signer.publicKey },
    });
    expect(report.document_status).toBe("valid");
    expect(report.signatures[0]!.valid).toBe(true);
    expect(report.timestamp?.message_imprint_matches).toBe(true);
    expect(report.genesis.included).toBe(true);
  });

  it("marca invalid_signature si la clave de confianza no coincide", async () => {
    const registry = createGenesisRegistry();
    const pkg = await sealDocument(
      {
        documentId: "doc-101",
        content: "otro",
        profile: "public-verifiable",
        document,
        generation,
        actions: [{ action: "created", when: "2026-09-17T20:00:00Z" }],
      },
      { signer, registry, tsa: dynamicTsa },
    );
    const report = await verifySealPackage(pkg, {
      tsaVerifier,
      trustedPublicKeys: { [signer.keyId]: generateEd25519KeyPair().publicKeyPem },
    });
    expect(report.document_status).toBe("invalid_signature");
  });

  it("valida inclusión Merkle contra el checkpoint", async () => {
    const registry = createGenesisRegistry();
    const pkg = await sealDocument(
      {
        documentId: "doc-102",
        content: "incluido",
        profile: "public-verifiable",
        document,
        generation,
        actions: [{ action: "created", when: "2026-09-17T20:00:00Z" }],
      },
      { signer, registry, tsa: dynamicTsa },
    );
    const leaves = await registry.leafHashes();
    const proof = buildInclusionProof(leaves, 0);
    const checkpoint = await buildGenesisCheckpoint({ registry, signer });
    const report = await verifySealPackage(pkg, {
      tsaVerifier,
      inclusionProof: proof,
      checkpoint: checkpoint!,
      trustedPublicKeys: { [signer.keyId]: signer.publicKey },
    });
    expect(report.genesis.inclusion_proof_valid).toBe(true);
    expect(report.genesis.checkpoint_signature_valid).toBe(true);
  });

  it("falla cerrado en long-term sin proveedor PQC y sella con proveedor", async () => {
    const registry = createGenesisRegistry();
    const base: SealDocumentInput = {
      documentId: "doc-200",
      content: "alta importancia",
      profile: "long-term",
      document,
      generation,
      actions: [{ action: "created", when: "2026-09-17T20:00:00Z" }],
    };

    registerPqcProvider(null);
    await expect(sealDocument(base, { signer, registry, tsa: dynamicTsa })).rejects.toThrow(
      /ML-DSA-65/,
    );

    const pqcKeys = generateEd25519KeyPair();
    const fakeProvider: PqcProvider = {
      algorithm: "ML-DSA-65",
      keyId: "test-mldsa65-1",
      publicKey: pqcKeys.publicKeyPem,
      sign: (data) =>
        createEd25519Signer({ privateKeyPem: pqcKeys.privateKeyPem, keyId: "x" }).sign(data),
      verify: (data, signature) => verifyEd25519(pqcKeys.publicKeyPem, data, signature),
    };
    registerPqcProvider(fakeProvider);
    try {
      const pkg = await sealDocument(base, { signer, registry, tsa: dynamicTsa });
      expect(pkg.seal.signature_algorithms).toEqual(["Ed25519", "ML-DSA-65"]);
      const report = await verifySealPackage(pkg, {
        tsaVerifier,
        trustedPublicKeys: {
          [signer.keyId]: signer.publicKey,
          [fakeProvider.keyId]: fakeProvider.publicKey,
        },
      });
      expect(report.document_status).toBe("valid");
      expect(report.signatures.every((item) => item.valid)).toBe(true);
    } finally {
      registerPqcProvider(null);
    }
  });
});

describe("IGDS revocación", () => {
  it("distingue válida en el momento de firmar de revocada antes", () => {
    const validAtSigning = evaluateTrust({
      signatureTime: "2026-09-17T20:03:11Z",
      revocationEffectiveAt: "2026-10-01T10:00:00Z",
      scope: "all_signatures_after_effective_at",
      signatureValid: true,
      timestampTrusted: true,
    });
    expect(validAtSigning.status).toBe("valid_at_signing_time");
    expect(validAtSigning.currentKeyStatus).toBe("revoked");

    const revokedBefore = evaluateTrust({
      signatureTime: "2026-10-02T10:00:00Z",
      revocationEffectiveAt: "2026-10-01T10:00:00Z",
      scope: "all_signatures_after_effective_at",
      signatureValid: true,
      timestampTrusted: true,
    });
    expect(revokedBefore.status).toBe("revoked_before_signing");

    const untrusted = evaluateTrust({
      signatureTime: null,
      revocationEffectiveAt: null,
      scope: null,
      signatureValid: true,
      timestampTrusted: false,
    });
    expect(untrusted.status).toBe("timestamp_untrusted");
  });
});

describe("IGDS identificador visible", () => {
  it("genera 12 caracteres Crockford deterministas", () => {
    const digest = digestHex("sha256", "abc");
    expect(shortSealId(digest)).toHaveLength(12);
    expect(shortSealId(digest)).toBe(shortSealId(digest));
  });
});
