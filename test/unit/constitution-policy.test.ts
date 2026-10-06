import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  evaluateConstitution,
  CONSTITUTION_POLICY_VERSION,
  READINESS_PROBE_PATH,
} from "@/lib/policy/constitution";

const regoPath = join(process.cwd(), "policy", "constitution.rego");
const deploymentPath = join(process.cwd(), "k8s", "deployment.yaml");

const fullyValid = {
  providerAvailable: true,
  classicalOk: true,
  postQuantumOk: true,
  policyOk: true,
  hashOk: true,
  runAsNonRoot: true,
  readinessProbe: READINESS_PROBE_PATH,
  sensitivity: "restricted",
  sealed: true,
  domain: "knowledge",
  federationId: null,
};

describe("constitution ejecutable (espejo de policy/constitution.rego)", () => {
  it("aprueba un input que cumple todas las reglas", () => {
    const result = evaluateConstitution(fullyValid);
    expect(result.ok).toBe(true);
    expect(result.policy).toBe(CONSTITUTION_POLICY_VERSION);
    expect(result.checks).toHaveLength(6);
  });

  it("falla-cerrado con input vacío (todos los defaults = false)", () => {
    const result = evaluateConstitution({});
    expect(result.ok).toBe(false);
    // Las cinco reglas allow nacen en false; la regla deny solo marca
    // hallazgo cuando la condición de fuga se cumple (aquí no aplica).
    for (const check of result.checks.filter((c) => c.rule !== "deny_federation_domain_leak")) {
      expect(check.ok).toBe(false);
    }
    expect(result.checks.find((c) => c.rule === "deny_federation_domain_leak")?.ok).toBe(true);
  });

  it("verify_allowed es AND estricto: un solo factor ausente deniega", () => {
    for (const missing of ["classicalOk", "postQuantumOk", "policyOk", "hashOk"] as const) {
      const result = evaluateConstitution({ ...fullyValid, [missing]: false });
      const verify = result.checks.find((c) => c.rule === "verify_allowed");
      expect(verify?.ok).toBe(false);
      expect(result.ok).toBe(false);
    }
  });

  it("sellado exige proveedor criptográfico disponible", () => {
    const result = evaluateConstitution({ ...fullyValid, providerAvailable: false });
    expect(result.checks.find((c) => c.rule === "seal_allowed")?.ok).toBe(false);
  });

  it("exige contenedor no root y readinessProbe correcto", () => {
    expect(
      evaluateConstitution({ ...fullyValid, runAsNonRoot: false }).checks.find(
        (c) => c.rule === "allow_run_as_non_root",
      )?.ok,
    ).toBe(false);
    expect(
      evaluateConstitution({ ...fullyValid, readinessProbe: "/api/yun/ready" }).checks.find(
        (c) => c.rule === "allow_readiness_probe",
      )?.ok,
    ).toBe(false);
  });

  it("sensibilidad alta sin sello deniega; sellada permite", () => {
    expect(
      evaluateConstitution({ ...fullyValid, sealed: false }).checks.find(
        (c) => c.rule === "allow_critical_sealed",
      )?.ok,
    ).toBe(false);
    expect(
      evaluateConstitution({ ...fullyValid, sensitivity: "critical", sealed: true }).checks.find(
        (c) => c.rule === "allow_critical_sealed",
      )?.ok,
    ).toBe(true);
    expect(
      evaluateConstitution({ ...fullyValid, sensitivity: "public" }).checks.find(
        (c) => c.rule === "allow_critical_sealed",
      )?.ok,
    ).toBe(false);
  });

  it("detecta fuga de dominio de federación", () => {
    const leak = evaluateConstitution({
      ...fullyValid,
      domain: "federations",
      federationId: "fed-123",
    });
    expect(leak.checks.find((c) => c.rule === "deny_federation_domain_leak")?.ok).toBe(false);
    expect(leak.ok).toBe(false);
  });
});

describe("paridad con policy/constitution.rego", () => {
  const rego = readFileSync(regoPath, "utf8");

  it("declara el paquete canónico y las seis reglas", () => {
    expect(rego).toContain("package isabella.constitution");
    for (const rule of [
      "seal_allowed",
      "verify_allowed",
      "allow_run_as_non_root",
      "allow_readiness_probe",
      "allow_critical_sealed",
      "deny_federation_domain_leak",
    ]) {
      expect(rego).toContain(rule);
    }
  });

  it("mantiene los defaults fail-closed de sellado y verificación", () => {
    expect(rego).toMatch(/default\s+seal_allowed\s*=\s*false/);
    expect(rego).toMatch(/default\s+verify_allowed\s*=\s*false/);
  });

  it("cada regla evaluada en TS existe en el rego", () => {
    const { checks } = evaluateConstitution(fullyValid);
    for (const check of checks) expect(rego).toContain(check.rule);
  });

  it("el readinessProbe del rego coincide con k8s/deployment.yaml", () => {
    const deployment = readFileSync(deploymentPath, "utf8");
    expect(rego).toContain(READINESS_PROBE_PATH);
    expect(deployment).toContain(`path: ${READINESS_PROBE_PATH}`);
    expect(deployment).toContain("runAsNonRoot: true");
  });
});
