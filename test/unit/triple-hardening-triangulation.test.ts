import { describe, expect, it } from "vitest";
import { CryptographicTriangulation } from "@/lib/crypto/triple-hardening-triangulation";

const tenantId = "tenant-tri-1";
const purpose = "governance-state";

describe("CryptographicTriangulation (triple hardening)", () => {
  it("round-trips encrypt/decrypt across the three vertices", async () => {
    const plaintext = "CROWN decision payload — fail-closed";
    const envelope = await CryptographicTriangulation.encrypt(plaintext, {
      tenantId,
      purpose,
    });
    expect(envelope.version).toBe("triangulation-v3-hardened");
    expect(envelope.vertexAlpha.cipher).toBe("aes-256-gcm");
    expect(envelope.vertexBeta.cipher).toBe("chacha20-poly1305");
    expect(envelope.vertexGamma.consensusAlgorithm).toContain("HMAC-SHA3-512");
    expect(envelope.vertexGamma.merkleRoot).toMatch(/^[0-9a-f]{64}$/);
    expect(envelope.vertexGamma.tripartiteChecksum).toMatch(/^[0-9a-f]{96}$/);
    const out = await CryptographicTriangulation.decrypt(envelope, { tenantId, purpose });
    expect(out).toBe(plaintext);
  });

  it("fails closed on tenant binding mismatch", async () => {
    const envelope = await CryptographicTriangulation.encrypt("secret", {
      tenantId,
      purpose,
    });
    await expect(
      CryptographicTriangulation.decrypt(envelope, { tenantId: "other", purpose }),
    ).rejects.toThrow(/Tenant binding mismatch/);
  });

  it("fails closed when purpose binding differs", async () => {
    const envelope = await CryptographicTriangulation.encrypt("secret", {
      tenantId,
      purpose,
    });
    await expect(
      CryptographicTriangulation.decrypt(envelope, { tenantId, purpose: "other-purpose" }),
    ).rejects.toThrow(/Purpose binding mismatch/);
  });

  it("fails closed when a vertex is tampered (checksum mismatch)", async () => {
    const envelope = await CryptographicTriangulation.encrypt("secret", {
      tenantId,
      purpose,
    });
    const tampered = {
      ...envelope,
      vertexGamma: {
        ...envelope.vertexGamma,
        merkleRoot: "0".repeat(64),
      },
    };
    await expect(
      CryptographicTriangulation.decrypt(tampered, { tenantId, purpose }),
    ).rejects.toThrow();
  });

  it("rejects unsupported envelope version", async () => {
    const envelope = await CryptographicTriangulation.encrypt("secret", {
      tenantId,
      purpose,
    });
    const bad = { ...envelope, version: "triangulation-v0" as "triangulation-v3-hardened" };
    await expect(CryptographicTriangulation.decrypt(bad, { tenantId, purpose })).rejects.toThrow(
      /Unsupported envelope version/,
    );
  });

  it("falls closed without a configured master secret and rejects short overrides (ISA-248)", async () => {
    const { resetConfigCache } = await import("@/lib/config");
    const previousEncryptionKey = process.env.ENCRYPTION_MASTER_KEY;
    const previousJwtSecret = process.env.AUTH_JWT_SECRET;
    delete process.env.ENCRYPTION_MASTER_KEY;
    delete process.env.AUTH_JWT_SECRET;
    resetConfigCache();
    try {
      await expect(
        CryptographicTriangulation.encrypt("secret", { tenantId, purpose }),
      ).rejects.toThrow(/ENCRYPTION_MASTER_KEY/);
      await expect(
        CryptographicTriangulation.encrypt("secret", {
          tenantId,
          purpose,
          masterKey: "short-key",
        }),
      ).rejects.toThrow(/at least 32 characters/);
    } finally {
      if (previousEncryptionKey !== undefined)
        process.env.ENCRYPTION_MASTER_KEY = previousEncryptionKey;
      if (previousJwtSecret !== undefined) process.env.AUTH_JWT_SECRET = previousJwtSecret;
      resetConfigCache();
    }
  });

  it("round-trips with an explicit master key override", async () => {
    const masterKey = "explicit-master-key-with-32-characters-min";
    const envelope = await CryptographicTriangulation.encrypt("secret", {
      tenantId,
      purpose,
      masterKey,
    });
    const out = await CryptographicTriangulation.decrypt(envelope, {
      tenantId,
      purpose,
      masterKey,
    });
    expect(out).toBe("secret");
    await expect(
      CryptographicTriangulation.decrypt(envelope, { tenantId, purpose }),
    ).rejects.toThrow();
  });
});
