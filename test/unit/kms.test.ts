import { describe, it, expect } from "vitest";

/**
 * KMS REAL (test/unit/kms.test.ts)
 * -----------------------------------------------------------------
 * AES-256-GCM con subclaves por secreto: roundtrip, tamper, clave
 * errónea, aislamiento entre keyNames y fail-closed sin master.
 */

import { EnvKMSProvider } from "@/lib/kms-provider";

const MASTER = "0123456789abcdef0123456789abcdef";

describe("EnvKMSProvider real", () => {
  it("roundtrip cifrado/descifrado", async () => {
    const kms = new EnvKMSProvider({ ENCRYPTION_MASTER_KEY: MASTER });
    const envelope = await kms.encrypt("bookpi", "secreto-territorial-ñ");
    expect(envelope.startsWith("v1:")).toBe(true);
    expect(await kms.decrypt("bookpi", envelope)).toBe("secreto-territorial-ñ");
  });

  it("IV aleatorio: dos cifrados difieren", async () => {
    const kms = new EnvKMSProvider({ ENCRYPTION_MASTER_KEY: MASTER });
    const a = await kms.encrypt("k", "mismo");
    const b = await kms.encrypt("k", "mismo");
    expect(a).not.toBe(b);
  });

  it("tamper en ciphertext/tag/iv falla", async () => {
    const kms = new EnvKMSProvider({ ENCRYPTION_MASTER_KEY: MASTER });
    const envelope = await kms.encrypt("k", "dato");
    const [prefix, iv, ct, tag] = envelope.split(":");
    // Flip en el MEDIO (bits significativos; el último char base64url
    // puede ser padding y decodificar idéntico).
    const flipMid = (part: string) => {
      const middle = Math.floor(part.length / 2);
      const replacement = part[middle] === "A" ? "B" : "A";
      return part.slice(0, middle) + replacement + part.slice(middle + 1);
    };
    await expect(kms.decrypt("k", [prefix, iv, flipMid(ct), tag].join(":"))).rejects.toThrow(
      /autenticación/i,
    );
    await expect(kms.decrypt("k", [prefix, iv, ct, flipMid(tag)].join(":"))).rejects.toThrow(
      /autenticación/i,
    );
    await expect(kms.decrypt("k", "basura")).rejects.toThrow(/formato/i);
  });

  it("clave maestra errónea no descifra", async () => {
    const a = new EnvKMSProvider({ ENCRYPTION_MASTER_KEY: MASTER });
    const b = new EnvKMSProvider({
      ENCRYPTION_MASTER_KEY: "fedcba9876543210fedcba9876543210",
    });
    const envelope = await a.encrypt("k", "dato");
    await expect(b.decrypt("k", envelope)).rejects.toThrow();
  });

  it("aislamiento por keyName", async () => {
    const kms = new EnvKMSProvider({ ENCRYPTION_MASTER_KEY: MASTER });
    const envelope = await kms.encrypt("alpha", "dato");
    await expect(kms.decrypt("beta", envelope)).rejects.toThrow();
  });

  it("deriva subclaves HKDF-SHA3-512 deterministas y separadas", async () => {
    const { hkdfSync } = await import("node:crypto");
    const derive = (info: string) =>
      Buffer.from(hkdfSync("sha3-512", MASTER, "", info, 32)).toString("hex");
    const expected = derive("isabella-kms-v1|bookpi");
    expect(expected).toHaveLength(64);
    expect(derive("isabella-kms-v1|otro")).not.toBe(expected);
  });

  it("sin master falla cerrado", async () => {
    const kms = new EnvKMSProvider({});
    await expect(kms.encrypt("k", "x")).rejects.toThrow(/ENCRYPTION_MASTER_KEY/);
  });
});
