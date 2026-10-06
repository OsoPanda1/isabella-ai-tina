import { describe, it, expect } from "vitest";
import { signJwtHs256, verifyJwt, type JwtClaims } from "../../src/lib/jwt-verifier";

const SECRET = "test_secret_at_least_16_bytes_xyz";
const ISSUER = "https://isabella.test";

function buildClaims(overrides: Partial<JwtClaims> = {}): JwtClaims {
  return {
    sub: "user_123",
    iss: ISSUER,
    aud: "isabella",
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...overrides,
  };
}

describe("JWT verifier (HS256) — verificación criptográfica", () => {
  it("firma y verifica un token válido", () => {
    const token = signJwtHs256(buildClaims(), SECRET);
    const result = verifyJwt(token, {
      key: SECRET,
      algorithm: "HS256",
      issuer: ISSUER,
      audiences: ["isabella"],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.sub).toBe("user_123");
      expect(result.payload.iss).toBe(ISSUER);
    }
  });

  it("rechaza un token manipulado (firma inválida)", () => {
    const token = signJwtHs256(buildClaims(), SECRET);
    const parts = token.split(".");
    const tamperedPayload = parts.slice(0, 2).join(".") + "." + "firma_maliciosa";
    const result = verifyJwt(tamperedPayload, {
      key: SECRET,
      algorithm: "HS256",
      issuer: ISSUER,
    });
    expect(result.ok).toBe(false);
  });

  it("rechaza un token expirado", () => {
    const token = signJwtHs256(buildClaims({ exp: Math.floor(Date.now() / 1000) - 100 }), SECRET);
    const result = verifyJwt(token, {
      key: SECRET,
      algorithm: "HS256",
      issuer: ISSUER,
    });
    expect(result.ok).toBe(false);
  });

  it("rechaza algoritmo 'none' o no coincidente (fail-closed)", () => {
    const header = `eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0`;
    const payload = Buffer.from(JSON.stringify(buildClaims())).toString("base64url");
    const noneToken = `${header}.${payload}.`;
    const result = verifyJwt(noneToken, { key: SECRET, algorithm: "HS256" });
    expect(result.ok).toBe(false);

    const rs256Token = signJwtHs256(buildClaims(), SECRET);
    const wrongAlg = verifyJwt(rs256Token, { key: SECRET, algorithm: "RS256" });
    expect(wrongAlg.ok).toBe(false);
  });

  it("rechaza audience no admitida", () => {
    const token = signJwtHs256(buildClaims(), SECRET);
    const result = verifyJwt(token, {
      key: SECRET,
      algorithm: "HS256",
      audiences: ["otra-aud"],
    });
    expect(result.ok).toBe(false);
  });

  it("rechaza issuer incorrecto", () => {
    const token = signJwtHs256(buildClaims(), SECRET);
    const result = verifyJwt(token, {
      key: SECRET,
      algorithm: "HS256",
      issuer: "https://otro-emisor.test",
    });
    expect(result.ok).toBe(false);
  });

  it("rechaza token sin claim 'sub'", () => {
    const noSub = signJwtHs256(buildClaims({ sub: "" }), SECRET);
    const result = verifyJwt(noSub, { key: SECRET, algorithm: "HS256" });
    expect(result.ok).toBe(false);
  });

  it("rechaza clave incorrecta (HMAC)", () => {
    const token = signJwtHs256(buildClaims(), SECRET);
    const result = verifyJwt(token, {
      key: "clave_incorrecta_totalmente_distinta",
      algorithm: "HS256",
    });
    expect(result.ok).toBe(false);
  });
});
