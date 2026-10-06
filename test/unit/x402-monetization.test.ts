// @ts-nocheck
import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import {
  GovernanceMonetizationGuard,
  BookPILedgerService,
  x402MonetizationConnector,
  signX402Payment,
  verifyPayloadECDSAP384,
  getX402PublicKeyPem,
  getX402PaymentVaultAddress,
  __resetX402CryptoState,
  MAX_MONETIZATION_AMOUNT_CENTS,
  PrincipalContext,
  type x402PaymentPayload,
} from "../../src/lib/monetization/x402-connector";
import {
  validateMonetizationAmount,
  economyCapabilityGate,
  resolveSubscriptionStatus,
} from "../../src/lib/monetization/economic-authority";
import {
  CrownSmartPaywallEngine,
  SmartPaywallEvaluationRequest,
} from "../../src/lib/crown-smart-paywall";
import {
  ISMF_25_MONETIZATION_METHODS,
  validateIsmfAccess,
  calculateIsmfSplit,
} from "../../src/lib/monetization/ismf-catalog";

function makePayload(overrides: Partial<x402PaymentPayload> = {}): x402PaymentPayload {
  const now = Date.now();
  return {
    v: 1,
    amountCents: 2000,
    currency: "USDC",
    resourceId: "mcp_weather_tool",
    tenantId: "tenant_rdm_01",
    nonce: `nonce_${now}_${randomUUID()}`,
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 4 * 60 * 1000).toISOString(),
    ...overrides,
  };
}

describe("ISABELLA SOVEREIGN MONETIZATION & x402 PROTOCOL SUITE", () => {
  const activeContext: PrincipalContext = {
    tenantId: "tenant_rdm_01",
    actorId: "usr_anubis_01",
    role: "CREATOR",
    scopes: ["monetization:execute", "economic"],
    subscriptionStatus: "ACTIVE",
  };

  const inactiveContext: PrincipalContext = {
    tenantId: "tenant_rdm_02",
    actorId: "usr_guest_02",
    role: "CREATOR",
    scopes: ["monetization:execute"],
    subscriptionStatus: "INACTIVE",
  };

  describe("1. GovernanceMonetizationGuard (CROWN & ARGUS Policy Gate)", () => {
    const guard = new GovernanceMonetizationGuard();

    it("rechaza peticiones si falta tenantId o actorId (ARGUS)", () => {
      const invalid = { ...activeContext, tenantId: "" };
      const res = guard.evaluateAccess(invalid);
      expect(res.allowed).toBe(false);
      expect(res.reason).toContain("ARGUS_AUTH_FAILED");
    });

    it("bloquea monetización si el usuario no tiene suscripción activa (CROWN)", () => {
      const res = guard.evaluateAccess(inactiveContext);
      expect(res.allowed).toBe(false);
      expect(res.reason).toContain("CROWN_POLICY_DENY: Active monthly subscription required");
    });

    it("autoriza la monetización cuando la suscripción mensual está ACTIVE", () => {
      const res = guard.evaluateAccess(activeContext);
      expect(res.allowed).toBe(true);
      expect(res.reason).toBeUndefined();
    });
  });

  describe("2. BookPILedgerService (WORM Immutability & 75/25 Split)", () => {
    const ledger = new BookPILedgerService();

    it("calcula hash SHA3-512 y firma ECDSA P-384 real verificable", () => {
      const hash = ledger.calculateSHA3_512("test-payload");
      expect(hash).toMatch(/^sha3-512:[a-f0-9]{128}$/);

      const sig = ledger.signPayloadECDSAP384(hash);
      // IEEE P1363 P-384: r||s = 96 bytes = 192 hex chars
      expect(sig).toMatch(/^ecdsa-p384-sig:[a-f0-9]{192}$/);
      expect(ledger.verifyPayloadECDSAP384(hash, sig)).toBe(true);
    });

    it("rechaza firma ECDSA P-384 alterada o de otro payload", () => {
      const hash = ledger.calculateSHA3_512("payload-a");
      const otherHash = ledger.calculateSHA3_512("payload-b");
      const sig = ledger.signPayloadECDSAP384(hash);

      expect(ledger.verifyPayloadECDSAP384(otherHash, sig)).toBe(false);

      const tampered = sig.replace(/[a-f0-9]$/, (c) => (c === "0" ? "1" : "0"));
      expect(ledger.verifyPayloadECDSAP384(hash, tampered)).toBe(false);

      // Un digest SHA-384 etiquetado NO debe pasar como firma ECDSA
      expect(verifyPayloadECDSAP384(hash, "ecdsa-p384-sig:" + "a".repeat(192))).toBe(false);
    });

    it("aplica el reparto estricto 75% Creador / 25% Plataforma en centavos", async () => {
      const grossCents = 10000; // $100.00 USD
      const event = await ledger.recordMonetizationTransaction(
        activeContext,
        "idemp_test_7525",
        grossCents,
        "v4.2.0-sovereign",
      );

      expect(event.grossAmountCents).toBe(10000);
      expect(event.creatorCreditCents).toBe(7500); // 75%
      expect(event.platformFeeCents).toBe(2500); // 25%
      expect(event.creatorCreditCents + event.platformFeeCents).toBe(grossCents);
      expect(event.currentHash).toMatch(/^sha3-512:/);
      expect(event.signature).toMatch(/^ecdsa-p384-sig:/);
      expect(verifyPayloadECDSAP384(event.currentHash, event.signature)).toBe(true);
      expect(event.eventId).toMatch(/^evt_bookpi_[0-9a-f-]{36}$/);
    });

    it("rechaza importes no enteros o no positivos en el ledger", async () => {
      await expect(
        ledger.recordMonetizationTransaction(activeContext, "idemp_x", 0, "v1"),
      ).rejects.toThrow(/INVALID_GROSS_AMOUNT/);
      await expect(
        ledger.recordMonetizationTransaction(activeContext, "idemp_y", -100, "v1"),
      ).rejects.toThrow(/INVALID_GROSS_AMOUNT/);
      await expect(
        ledger.recordMonetizationTransaction(activeContext, "idemp_z", 10.5, "v1"),
      ).rejects.toThrow(/INVALID_GROSS_AMOUNT/);
    });
  });

  describe("3. x402MonetizationConnector (HTTP 402 Challenge & Settlement)", () => {
    let connector: x402MonetizationConnector;

    beforeEach(() => {
      connector = new x402MonetizationConnector();
    });

    it("devuelve 403 Forbidden con CROWN_POLICY_DENY para usuarios sin suscripción mensual", async () => {
      const res = await connector.handleMonetizationRequest(
        inactiveContext,
        "mcp_weather_tool",
        500,
      );

      expect(res.status).toBe(403);
      expect(res.body.error).toContain("Active monthly subscription required");
    });

    it("devuelve desafío HTTP 402 con términos si no se incluye encabezado de pago", async () => {
      const res = await connector.handleMonetizationRequest(activeContext, "mcp_weather_tool", 500);

      expect(res.status).toBe(402);
      expect(res.headers["X-402-Payment-Required"]).toBe("true");
      expect(res.headers["X-402-Price-Cents"]).toBe("500");
      expect(res.body.terms).toBeDefined();
      expect(res.body.terms.priceCentsUSD).toBe(500);
      expect(res.body.terms.currency).toBe("USDC");
    });

    it("rechaza importes inválidos (0, negativos, no enteros, excesivos)", async () => {
      for (const bad of [0, -100, 10.5, MAX_MONETIZATION_AMOUNT_CENTS + 1]) {
        const res = await connector.handleMonetizationRequest(
          activeContext,
          "mcp_weather_tool",
          bad,
        );
        expect(res.status).toBe(400);
        expect(res.body.error).toBe("INVALID_AMOUNT");
      }
    });

    it("devuelve 400 si la firma de pago x402 es basura o de formato antiguo", async () => {
      for (const junk of [
        "bad_sig",
        "x402_sig_valid_cryptographic_payload_a2a_token_123456",
        "x402 qualquer coisa longa o suficiente",
      ]) {
        const res = await connector.handleMonetizationRequest(
          activeContext,
          "mcp_weather_tool",
          500,
          junk,
        );
        expect(res.status).toBe(400);
        expect(res.body.error).toBe("INVALID_X402_PAYMENT_SIGNATURE");
      }
    });

    it("liquida exitosamente con 200 OK y reparto 75/25 con firma ECDSA P-384 real", async () => {
      const payload = makePayload({ amountCents: 2000 });
      const header = signX402Payment(payload);

      const res = await connector.handleMonetizationRequest(
        activeContext,
        "mcp_weather_tool",
        2000,
        header,
      );

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.distribution.totalGrossUSD).toBe(20.0);
      expect(res.body.distribution.creator75PercentUSD).toBe(15.0); // 75%
      expect(res.body.distribution.platform25PercentUSD).toBe(5.0); // 25%
      expect(res.body.bookPIEntry.currentHash).toMatch(/^sha3-512:/);
      expect(verifyPayloadECDSAP384(res.body.bookPIEntry.currentHash, res.body.bookPIEntry.signature)).toBe(
        true,
      );
    });

    it("rechaza firma válida firmada para OTRO importe (amount binding)", async () => {
      const payload = makePayload({ amountCents: 1000 }); // firmado por 10.00
      const header = signX402Payment(payload);

      const res = await connector.handleMonetizationRequest(
        activeContext,
        "mcp_weather_tool",
        2000, // servidor espera 20.00
        header,
      );

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("INVALID_X402_PAYMENT_SIGNATURE");
      expect(res.body.reason).toBe("AMOUNT_BINDING_MISMATCH");
    });

    it("rechaza firma válida para OTRO recurso (resource binding)", async () => {
      const payload = makePayload({ resourceId: "otro_recurso" });
      const header = signX402Payment(payload);

      const res = await connector.handleMonetizationRequest(
        activeContext,
        "mcp_weather_tool",
        2000,
        header,
      );

      expect(res.status).toBe(400);
      expect(res.body.reason).toBe("RESOURCE_BINDING_MISMATCH");
    });

    it("rechaza firma válida para OTRO tenant (tenant binding)", async () => {
      const payload = makePayload({ tenantId: "tenant_intruso" });
      const header = signX402Payment(payload);

      const res = await connector.handleMonetizationRequest(
        activeContext,
        "mcp_weather_tool",
        2000,
        header,
      );

      expect(res.status).toBe(400);
      expect(res.body.reason).toBe("TENANT_BINDING_MISMATCH");
    });

    it("rechaza replay del mismo nonce (anti-replay)", async () => {
      const payload = makePayload({ amountCents: 2000 });
      const header = signX402Payment(payload);

      const first = await connector.handleMonetizationRequest(
        activeContext,
        "mcp_weather_tool",
        2000,
        header,
      );
      expect(first.status).toBe(200);

      const replay = await connector.handleMonetizationRequest(
        activeContext,
        "mcp_weather_tool",
        2000,
        header,
      );
      expect(replay.status).toBe(400);
      expect(replay.body.reason).toBe("NONCE_REPLAY_DETECTED");
    });

    it("rechaza pagos con timestamp expirado", async () => {
      const past = Date.now() - 10 * 60 * 1000;
      const payload = makePayload({
        issuedAt: new Date(past).toISOString(),
        expiresAt: new Date(past + 60 * 1000).toISOString(),
      });
      const header = signX402Payment(payload);

      const res = await connector.handleMonetizationRequest(
        activeContext,
        "mcp_weather_tool",
        2000,
        header,
      );
      expect(res.status).toBe(400);
      expect(res.body.reason).toBe("EXPIRED_OR_NOT_YET_VALID");
    });

    it("rechaza payload con bytes alterados tras la firma (integridad del payload)", async () => {
      const payload = makePayload({ amountCents: 2000 });
      const header = signX402Payment(payload);
      // Alterar el segmento del payload conservando longitud
      const tampered = header.replace(
        /^x402 v1\.([A-Za-z0-9_-]+)/,
        (_m, b64: string) => `x402 v1.${b64.slice(0, -1)}${b64.endsWith("A") ? "B" : "A"}`,
      );

      const res = await connector.handleMonetizationRequest(
        activeContext,
        "mcp_weather_tool",
        2000,
        tampered,
      );
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("INVALID_X402_PAYMENT_SIGNATURE");
    });

    it("expone clave pública PEM para verificación externa", () => {
      const pem = getX402PublicKeyPem();
      expect(pem).toContain("BEGIN PUBLIC KEY");
    });
  });

  describe("3b. EconomicAuthority (contrato económico y capability gate)", () => {
    it("validateMonetizationAmount acepta enteros positivos dentro del límite", () => {
      expect(validateMonetizationAmount(1)).toEqual({ ok: true, amountCents: 1 });
      expect(validateMonetizationAmount(1000)).toEqual({ ok: true, amountCents: 1000 });
      expect(validateMonetizationAmount(MAX_MONETIZATION_AMOUNT_CENTS)).toEqual({
        ok: true,
        amountCents: MAX_MONETIZATION_AMOUNT_CENTS,
      });
    });

    it("validateMonetizationAmount rechaza 0, negativos, fraccionarios, excesivos y no-numéricos", () => {
      for (const bad of [0, -1, 10.5, MAX_MONETIZATION_AMOUNT_CENTS + 1, "1000", null, NaN]) {
        const res = validateMonetizationAmount(bad);
        expect(res.ok).toBe(false);
      }
    });

    it("economyCapabilityGate no bloquea en development", () => {
      expect(economyCapabilityGate().blocked).toBe(false);
    });

    it("resolveSubscriptionStatus nunca proviene del cliente y es trazable", () => {
      const res = resolveSubscriptionStatus("tenant_x", "user_x");
      expect(["durable", "development-default", "unavailable-fail-closed"]).toContain(res.source);
      expect(["ACTIVE", "PAST_DUE", "INACTIVE", "EXPIRED"]).toContain(res.status);
      if (res.status === "ACTIVE") {
        expect(["durable", "development-default"]).toContain(res.source);
      } else {
        expect(["durable", "unavailable-fail-closed"]).toContain(res.source);
      }
    });
  });

  describe("4. CrownSmartPaywallEngine (5-Step Dynamic Smart Paywall)", () => {
    const paywall = new CrownSmartPaywallEngine();

    it("bloquea con DENY (403) si la suscripción no está ACTIVE", () => {
      const req: SmartPaywallEvaluationRequest = {
        traceId: "tr_01",
        requestId: "rq_01",
        context: inactiveContext,
        resourceId: "doc_territorial_01",
        resourceType: "PREMIUM_CONTENT",
        epistemicComplexity: "E1",
        currentQuotaUsed: 5,
        maxQuotaAllowed: 100,
      };

      const decision = paywall.evaluate(req);
      expect(decision.decision).toBe("DENY");
      expect(decision.httpStatusCode).toBe(403);
      expect(decision.allowed).toBe(false);
    });

    it("concede ALLOW (200) para usuario con suscripción dentro de cuota", () => {
      const req: SmartPaywallEvaluationRequest = {
        traceId: "tr_02",
        requestId: "rq_02",
        context: activeContext,
        resourceId: "doc_territorial_01",
        resourceType: "PREMIUM_CONTENT",
        epistemicComplexity: "E1",
        currentQuotaUsed: 5,
        maxQuotaAllowed: 100,
      };

      const decision = paywall.evaluate(req);
      expect(decision.decision).toBe("ALLOW");
      expect(decision.httpStatusCode).toBe(200);
      expect(decision.allowed).toBe(true);
    });

    it("emite X402_CHALLENGE (402) para llamadas A2A / API cuando la cuota fue excedida", () => {
      const req: SmartPaywallEvaluationRequest = {
        traceId: "tr_03",
        requestId: "rq_03",
        context: activeContext,
        resourceId: "api_inference_01",
        resourceType: "API_INFERENCE",
        epistemicComplexity: "E2",
        currentQuotaUsed: 1000,
        maxQuotaAllowed: 1000,
        requestedPriceCents: 250,
      };

      const decision = paywall.evaluate(req);
      expect(decision.decision).toBe("X402_CHALLENGE");
      expect(decision.httpStatusCode).toBe(402);
      expect(decision.x402Terms?.priceCentsUSD).toBe(250);
      expect(decision.x402Terms?.currency).toBe("USDC");
    });
  });

  describe("5. ISMF 25 Native Monetization Methods Catalog", () => {
    it("incluye los 25 métodos de monetización canónicos", () => {
      const methods = Object.values(ISMF_25_MONETIZATION_METHODS);
      expect(methods.length).toBe(25);
    });

    it("todos los 25 métodos exigen suscripción mensual ACTIVE para monetizar", () => {
      for (const method of Object.values(ISMF_25_MONETIZATION_METHODS)) {
        expect(method.minimumSubscriptionRequired).toBe("ACTIVE");
        expect(method.creatorSplitPct).toBe(75);
        expect(method.platformSplitPct).toBe(25);
      }
    });

    it("rechaza acceso a cualquier método ISMF si la suscripción está inactiva", () => {
      const test = validateIsmfAccess("method-01-api-mcp", inactiveContext);
      expect(test.allowed).toBe(false);
      expect(test.reason).toContain("CROWN_POLICY_DENY");
    });

    it("permite acceso a métodos ISMF cuando la suscripción mensual está activa", () => {
      const test = validateIsmfAccess("method-01-api-mcp", activeContext);
      expect(test.allowed).toBe(true);
      expect(test.method?.id).toBe("method-01-api-mcp");
    });

    it("calcula correctamente el split 75/25 en dólares con calculateIsmfSplit", () => {
      const split = calculateIsmfSplit(100.0);
      expect(split.creatorPct).toBe(75);
      expect(split.creatorUsd).toBe(75.0);
      expect(split.platformPct).toBe(25);
      expect(split.platformUsd).toBe(25.0);
    });
  });

  describe("6. Higiene de clave criográfica", () => {
    it("usa una dirección EVM válida para el desafío x402", () => {
      expect(getX402PaymentVaultAddress()).toMatch(/^0x[a-fA-F0-9]{40}$/);
    });

    it("reset de estado crypto es expuesto para tests aislados", () => {
      expect(typeof __resetX402CryptoState).toBe("function");
      __resetX402CryptoState();
      const pem = getX402PublicKeyPem();
      expect(pem).toContain("BEGIN PUBLIC KEY");
    });
  });
});
