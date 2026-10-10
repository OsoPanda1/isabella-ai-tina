import { describe, expect, it } from "vitest";
import {
  decryptTriangularEnvelope,
  encryptTriangularEnvelope,
  deriveLocalKmsKey,
} from "@/lib/crypto/triangular-envelope";

function kms() {
  const key = deriveLocalKmsKey(Buffer.alloc(32, 7), "test-key");
  return {
    wrapKey: async (_keyId: string, dek: Buffer) =>
      Buffer.from(dek.map((value, index) => value ^ key[index]!)).toString("base64url"),
    unwrapKey: async (_keyId: string, wrapped: string) =>
      Buffer.from(Buffer.from(wrapped, "base64url").map((value, index) => value ^ key[index]!)),
  };
}

describe("triangular envelope", () => {
  it("round-trips with tenant and purpose binding", async () => {
    const envelope = await encryptTriangularEnvelope(
      "datos soberanos",
      { tenantId: "tenant-1", purpose: "memory", keyId: "test-key" },
      kms(),
    );
    await expect(
      decryptTriangularEnvelope(envelope, { tenantId: "tenant-1", purpose: "memory" }, kms()),
    ).resolves.toBe("datos soberanos");
  });
  it("rejects cross-tenant decryption", async () => {
    const envelope = await encryptTriangularEnvelope(
      "privado",
      { tenantId: "tenant-1", purpose: "memory", keyId: "test-key" },
      kms(),
    );
    await expect(
      decryptTriangularEnvelope(envelope, { tenantId: "tenant-2", purpose: "memory" }, kms()),
    ).rejects.toThrow("tenant_binding_mismatch");
  });
});
