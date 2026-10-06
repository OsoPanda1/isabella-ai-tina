import { afterAll, describe, expect, it } from "vitest";
import { authorizationCrypto, evaluateAuthorization } from "@/lib/authorization";
import { resetConfigCache } from "@/lib/config";

const base = {
  tenant_id: "tenant-a",
  subject_id: "user-a",
  action: "execute",
  resource: "tool",
  role: "Operator",
  authenticated: true,
  context: {
    ip_address: "127.0.0.1",
    user_agent: "vitest",
    timestamp: new Date(),
  },
};

describe("Authorization PDP", () => {
  it("denies missing identity", async () => {
    const decision = await evaluateAuthorization({ ...base, subject_id: "" });
    expect(decision.allow).toBe(false);
    expect(decision.obligations.join(" ")).toContain("missing-identity");
  });

  it("denies unauthenticated principals", async () => {
    const decision = await evaluateAuthorization({ ...base, authenticated: false });
    expect(decision.allow).toBe(false);
  });

  it("denies unknown roles and operations", async () => {
    const unknownRole = await evaluateAuthorization({ ...base, role: "root" });
    const unknownAction = await evaluateAuthorization({ ...base, action: "delete" });
    expect(unknownRole.allow).toBe(false);
    expect(unknownAction.allow).toBe(false);
  });

  it("allows a scoped read for an authenticated operator", async () => {
    const decision = await evaluateAuthorization(base);
    expect(decision.allow).toBe(true);
    expect(decision.tenant_id).toBe(base.tenant_id);
    expect(decision.subject_id).toBe(base.subject_id);
    expect(decision.signature).toBeTruthy();
  });

  it("fails closed on behavioral anomaly", async () => {
    const decision = await evaluateAuthorization({
      ...base,
      context: { ...base.context, behavior_score: 99 },
    });
    expect(decision.allow).toBe(false);
  });
});

describe("canonicalización de hashes del PDP (RFC 8785)", () => {
  const payload = () => ({
    decision_id: "dec_1",
    obligations: ["log_verbose", "pqc_signature_required"],
    nested: { b: 2, a: 1 },
    allow: true,
  });

  it("produce el mismo hash sin importar el orden de construcción de claves", () => {
    const ordenA = payload();
    const ordenB = {
      allow: true,
      nested: { a: 1, b: 2 },
      obligations: ["log_verbose", "pqc_signature_required"],
      decision_id: "dec_1",
    };
    expect(authorizationCrypto.calculateHash(ordenA)).toBe(
      authorizationCrypto.calculateHash(ordenB),
    );
  });

  it("cambia el hash cuando cambia un valor", () => {
    const original = payload();
    const alterado = { ...payload(), allow: false };
    expect(authorizationCrypto.calculateHash(original)).not.toBe(
      authorizationCrypto.calculateHash(alterado),
    );
  });

  it("firma y verifica el payload canónico, y rechaza alteraciones", () => {
    const signature = authorizationCrypto.signPayload(payload());
    expect(authorizationCrypto.verifySignature(payload(), signature)).toBe(true);
    expect(authorizationCrypto.verifySignature({ ...payload(), allow: false }, signature)).toBe(
      false,
    );
  });
});

describe("aislamiento territorial ABAC", () => {
  it("deniega cuando el recurso pertenece a otro tenant", async () => {
    const decision = await evaluateAuthorization({
      ...base,
      resource_tenant_id: "tenant-b",
    });
    expect(decision.allow).toBe(false);
    expect(decision.obligations.join(" ")).toContain("abac-deny:isolation:territorial");
  });

  it("permite cuando el recurso pertenece al mismo tenant", async () => {
    const decision = await evaluateAuthorization({
      ...base,
      resource_tenant_id: "tenant-a",
    });
    expect(decision.allow).toBe(true);
  });

  it("no afirma tenant de recurso desconocido (política queda notApplied)", async () => {
    const decision = await evaluateAuthorization(base);
    expect(decision.allow).toBe(true);
  });
});

describe("cadena durable fail-closed", () => {
  const saved = {
    NODE_ENV: process.env.NODE_ENV,
    ISABELLA_RUNTIME_MODE: process.env.ISABELLA_RUNTIME_MODE,
  };

  afterAll(() => {
    if (saved.NODE_ENV === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = saved.NODE_ENV;
    if (saved.ISABELLA_RUNTIME_MODE === undefined) delete process.env.ISABELLA_RUNTIME_MODE;
    else process.env.ISABELLA_RUNTIME_MODE = saved.ISABELLA_RUNTIME_MODE;
    resetConfigCache();
  });

  it("convierte la decisión en DENY cuando no hay cadena durable en runtime productivo", async () => {
    process.env.ISABELLA_RUNTIME_MODE = "production";
    process.env.NODE_ENV = "production";
    resetConfigCache();

    const decision = await evaluateAuthorization(base);

    expect(decision.allow).toBe(false);
    expect(decision.obligations.join(" ")).toContain("deny:hsm-durable-unavailable");
    expect(decision.signature_chain).toBe("unavailable:hsm-durable");
  });
});

export {};
