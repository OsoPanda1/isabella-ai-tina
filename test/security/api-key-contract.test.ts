import { beforeAll, describe, expect, it } from "vitest";

let ApiKeyCrypto: typeof import("@/lib/api-key-crypto").ApiKeyCrypto;

beforeAll(async () => {
  process.env.API_KEY_HASH_SECRET = "test-api-key-hash-secret-32-bytes-minimum";
  const module = await import("@/lib/api-key-crypto");
  ApiKeyCrypto = module.ApiKeyCrypto;
});

describe("Isabella API key contract", () => {
  it("generates high-entropy URL-safe secrets", () => {
    const secret = ApiKeyCrypto.generateSecret();
    expect(secret).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(secret.length).toBeGreaterThanOrEqual(64);
  });

  it("uses a compact identifier suitable for the public key prefix", () => {
    const identifier = ApiKeyCrypto.generatePrefix();
    expect(identifier).toMatch(/^[a-f0-9]{12}$/);
  });

  it("hashes and verifies the complete credential without storing plaintext", () => {
    const rawKey = `isk_live_${ApiKeyCrypto.generatePrefix()}_${ApiKeyCrypto.generateSecret()}`;
    const hash = ApiKeyCrypto.hashSecret(rawKey);

    expect(hash).toMatch(/^v7\.[a-f0-9]{32}\.[a-f0-9]{128}$/);
    expect(hash).not.toContain(rawKey);
    expect(ApiKeyCrypto.verifySecret(rawKey, hash)).toBe(true);
    expect(ApiKeyCrypto.verifySecret(`${rawKey}x`, hash)).toBe(false);
  });
});
