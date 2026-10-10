import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as crypto from "node:crypto";
import { AuthVerificationLayer } from "../../src/lib/auth-verification-layer";
import { signJwtHs256 } from "../../src/lib/jwt-verifier";
import { SecuritySystem } from "../../src/lib/security";

const TEST_SECRET = "super_secret_jwt_auth_key_at_least_32_chars";
const INTERNAL_ISSUER = "TAMV Online Network Security Hub";
const TRUSTED_OIDC_ISSUER = "https://auth.tamv.network";

describe("AuthVerificationLayer — Rigorous JWKS/OIDC Verification and Audit Trail", () => {
  let rsaPrivateKey: crypto.KeyObject;
  let rsaPublicKey: crypto.KeyObject;
  let rsaJwk: { kty: string; n: string; e: string; kid: string; use: string; alg: string };

  beforeEach(() => {
    process.env.AUTH_JWT_SECRET = TEST_SECRET;
    // Generar par de claves RSA para pruebas de OIDC/JWKS
    const pair = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
    rsaPrivateKey = pair.privateKey;
    rsaPublicKey = pair.publicKey;
    const jwk = pair.publicKey.export({ format: "jwk" }) as { kty: string; n: string; e: string };
    rsaJwk = {
      ...jwk,
      kid: "test-key-2026-01",
      use: "sig",
      alg: "RS256",
    };

    // Registrar proveedor OIDC de prueba
    AuthVerificationLayer.registerTrustedProvider({
      issuer: TRUSTED_OIDC_ISSUER,
      audience: "isabella",
    });

    // Mockear fetch para responder con el JWKS del proveedor OIDC
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request) => {
        const urlStr = typeof url === "string" ? url : url.toString();
        if (urlStr.includes(".well-known/jwks.json")) {
          return new Response(
            JSON.stringify({
              keys: [rsaJwk],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response("Not found", { status: 404 });
      }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    AuthVerificationLayer.resetJwksCache();
  });

  function signRsaToken(payload: Record<string, unknown>, kid = "test-key-2026-01"): string {
    const header = { alg: "RS256", typ: "JWT", kid };
    const headerB64 = Buffer.from(JSON.stringify(header)).toString("base64url");
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const signingInput = `${headerB64}.${payloadB64}`;
    const signature = crypto
      .createSign("RSA-SHA256")
      .update(signingInput)
      .sign(rsaPrivateKey, "base64url");
    return `${signingInput}.${signature}`;
  }

  describe("Anti-Spoofing & Algorithmic Defense", () => {
    it("rechaza de inmediato tokens con 'alg: none' y registra evento de severidad S0", async () => {
      const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
      const payload = Buffer.from(
        JSON.stringify({
          sub: "attacker_01",
          iss: INTERNAL_ISSUER,
          aud: "isabella",
          exp: Math.floor(Date.now() / 1000) + 3600,
        }),
      ).toString("base64url");
      const noneToken = `${header}.${payload}.`;

      const result = await AuthVerificationLayer.verifyToken(noneToken, {
        ip: "192.168.1.100",
        traceId: "TR_NONE_ATTACK",
        correlationId: "CORR_NONE_01",
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.spoofingAttempt).toBe(true);
        expect(result.auditSeverity).toBe("S0");
        expect(result.reasonCode).toBe("ALGORITHM_NONE_FORBIDDEN");
      }
    });

    it("rechaza ataques por confusión de algoritmo (emisor externo intentando firmar con HS256)", async () => {
      // Un atacante usa HS256 fingiendo ser un IdP externo para explotar confusión de clave pública como secreto HMAC
      const token = signJwtHs256(
        {
          sub: "attacker_spoof",
          iss: "https://evil.attacker.com",
          aud: "isabella",
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + 3600,
        },
        TEST_SECRET,
      );

      const result = await AuthVerificationLayer.verifyToken(token, {
        ip: "10.0.0.99",
        traceId: "TR_CONFUSION_ATTACK",
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.spoofingAttempt).toBe(true);
        expect(result.auditSeverity).toBe("S0");
      }
    });

    it("rechaza emisores no reconocidos en la whitelist soberana (anti-spoofing)", async () => {
      const token = signRsaToken({
        sub: "user_fake",
        iss: "https://untrusted-idp.example.com",
        aud: "isabella",
        exp: Math.floor(Date.now() / 1000) + 3600,
      });

      const result = await AuthVerificationLayer.verifyToken(token);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.spoofingAttempt).toBe(true);
        expect(result.reasonCode).toBe("UNTRUSTED_ISSUER");
        expect(result.auditSeverity).toBe("S0");
      }
    });
  });

  describe("Internal Sovereign Token Verification (HS256)", () => {
    it("autentica correctamente tokens válidos emitidos por el Hub de Seguridad Soberano", async () => {
      const token = await SecuritySystem.generateSovereignToken(
        "user_alice",
        "Operator",
        "tenant_real_del_monte",
        "isabella:chat",
      );

      const result = await AuthVerificationLayer.verifyToken(token, {
        ip: "127.0.0.1",
        traceId: "TR_SOV_OK",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.provider).toBe("internal_sovereign");
        expect(result.identity.userId).toBe("user_alice");
        expect(result.identity.tenantId).toBe("tenant_real_del_monte");
        expect(result.identity.role).toBe("Operator");
        expect(result.auditSeverity).toBe("S3");
      }
    });

    it("rechaza tokens manipulados en firma o payload", async () => {
      const validToken = await SecuritySystem.generateSovereignToken(
        "user_alice",
        "Operator",
        "tenant_01",
        "isabella:chat",
      );
      const parts = validToken.split(".");
      const tampered = `${parts[0]}.${parts[1]}.tampered_signature_xyz`;

      const result = await AuthVerificationLayer.verifyToken(tampered);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.reasonCode).toBe("SIGNATURE_TAMPERED");
        expect(result.auditSeverity).toBe("S1");
      }
    });
  });

  describe("OIDC / JWKS Provider Verification (RS256)", () => {
    it("verifica exitosamente un token RS256 mediante clave pública JWKS resolviendo por kid", async () => {
      const token = signRsaToken({
        sub: "oidc_user_456",
        iss: TRUSTED_OIDC_ISSUER,
        aud: "isabella",
        exp: Math.floor(Date.now() / 1000) + 1800,
        tenantId: "tenant_federated",
        role: "Operator",
      });

      const result = await AuthVerificationLayer.verifyToken(token, {
        ip: "203.0.113.1",
        traceId: "TR_OIDC_VALID",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.provider).toBe("oidc_jwks");
        expect(result.identity.userId).toBe("oidc_user_456");
        expect(result.identity.tenantId).toBe("tenant_federated");
        expect(result.identity.role).toBe("Operator");
      }
    });

    it("rechaza tokens OIDC con kid desconocido o ausente en el JWKS", async () => {
      const token = signRsaToken(
        {
          sub: "oidc_user_456",
          iss: TRUSTED_OIDC_ISSUER,
          aud: "isabella",
          exp: Math.floor(Date.now() / 1000) + 1800,
        },
        "unknown-kid-9999",
      );

      const result = await AuthVerificationLayer.verifyToken(token);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.reasonCode).toBe("JWKS_KEY_NOT_FOUND");
        expect(result.auditSeverity).toBe("S1");
      }
    });

    it("rechaza tokens OIDC expirados y clasifica con severidad S2 (advertencia)", async () => {
      const expiredToken = signRsaToken({
        sub: "oidc_user_expired",
        iss: TRUSTED_OIDC_ISSUER,
        aud: "isabella",
        exp: Math.floor(Date.now() / 1000) - 300, // Expirado hace 5 min
      });

      const result = await AuthVerificationLayer.verifyToken(expiredToken);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.reasonCode).toBe("TOKEN_EXPIRED");
        expect(result.auditSeverity).toBe("S2");
      }
    });
  });

});
