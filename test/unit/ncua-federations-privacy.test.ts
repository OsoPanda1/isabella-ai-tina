import { describe, expect, it } from "vitest";

import {
  FederationController,
  FederatedAttentionBridge,
  type FederationContext,
} from "@/lib/ncua/federations";
import { embed } from "@/lib/ncua/embed";
import { PrivacyBudget, kAnonymity, lDiversity, membershipRiskBound } from "@/lib/ncua/privacy";

const benignContext = (overrides: Partial<FederationContext> = {}): FederationContext => ({
  inputBytesLength: 120,
  intent: "consulta-generica",
  confidence: 0.85,
  groundedFacts: 2,
  memoryHits: 1,
  wantPrivileged: false,
  wantEgress: false,
  wantExecution: false,
  authorshipApproved: true,
  tenantBoundaryOk: true,
  principalPresent: true,
  capabilityTokenPresent: false,
  sandboxAllowed: true,
  ...overrides,
});

describe("ncua:federaciones (heptafederación, 7 votos)", () => {
  it("aprueba solicitdes fundamentadas, insulares y gobernadas", () => {
    const result = new FederationController().evaluate(benignContext());
    expect(result.totalVotes).toBe(7);
    expect(result.approved).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(0.7);
  });

  it("veta peticiones con egress (rompe soberanía y economía)", () => {
    const result = new FederationController().evaluate(
      benignContext({ wantEgress: true, intent: "exfiltracion" }),
    );
    expect(result.vetoActive).toBe(true);
    expect(result.approved).toBe(false);
  });

  it("mantiene el axioma: capacidad no implica autoridad", () => {
    const result = new FederationController().evaluate(
      benignContext({ intent: "payout", capabilityTokenPresent: false }),
    );
    expect(result.votes[0]?.approved).toBe(false);
  });

  it("reduce consenso ante confianza sin fundamento (anti-alucinación)", () => {
    const result = new FederationController().evaluate(
      benignContext({ confidence: 0.95, groundedFacts: 0, memoryHits: 0 }),
    );
    const cognitive = result.votes.find((vote) => vote.id === "F4");
    expect(cognitive?.approved).toBe(false);
  });
});

describe("ncua:puente de atención autoencoder↔federaciones", () => {
  it("es determinista con semilla fija", () => {
    const latent = [embed("Real del Monte", { dim: 192 }), embed("plata 925", { dim: 192 })];
    const a = new FederatedAttentionBridge({ seed: 42 }).forward(latent);
    const b = new FederatedAttentionBridge({ seed: 42 }).forward(latent);
    expect(a.consensusScore).toBe(b.consensusScore);
    expect(a.outputLatent.length).toBe(192);
    expect(Array.from(a.consensusGates)).toEqual(Array.from(b.consensusGates));
  });

  it("emite gates en [0,1] por federación y pesos de atención auditables", () => {
    const latent = [embed("minería y patrimonio industrial", { dim: 192 })];
    const output = new FederatedAttentionBridge({}).forward(latent);
    expect(output.consensusGates.length).toBe(7);
    for (let index = 0; index < 7; index += 1) {
      expect(output.consensusGates[index]).toBeGreaterThanOrEqual(0);
      expect(output.consensusGates[index]).toBeLessThanOrEqual(1);
    }
    expect(output.attentionWeights.length).toBe(8);
    for (const head of output.attentionWeights) {
      expect(head.length).toBe(7);
      for (const row of head) {
        expect(row.length).toBe(7);
        const sum = row.reduce((total, value) => total + value, 0);
        expect(sum).toBeCloseTo(1, 2);
      }
    }
    expect(output.gateContributions.length).toBe(7);
  });

  it("expone la formulación matemática del puente", () => {
    const bridge = new FederatedAttentionBridge({});
    const formula = bridge.mathematicalFormulation();
    expect(formula).toContain("MultiHead");
    expect(formula).toContain("consensus");
    expect(formula).toContain("\\sqrt{d_k}");
  });
});

describe("ncua:privacidad diferencial y anonimato", () => {
  it("consuma presupuesto y agota el gasto", () => {
    const budget = new PrivacyBudget(0.5, 1e-5);
    expect(budget.spend(0.2)).toBe(true);
    const noisy = budget.noisy(10, 1, "laplace", 0.3);
    expect(noisy).not.toBeNull();
    expect(budget.spend(0.2)).toBe(false);
  });

  it("verifica k-anonimato", () => {
    const rows = [
      { municipio: "Pachuca", oficio: "platero" },
      { municipio: "Pachuca", oficio: "platero" },
      { municipio: "Pachuca", oficio: "platero" },
      { municipio: "Real del Monte", oficio: "minero" },
    ];
    const report = kAnonymity(rows, ["municipio", "oficio"], 3);
    expect(report.satisfiesK).toBe(false);
    expect(report.minGroupSize).toBe(1);
    const ok = kAnonymity(rows, [], 3);
    expect(ok.satisfiesK).toBe(true);
  });

  it("verifica l-diversidad", () => {
    const rows = [
      { municipio: "Pachuca", diet: "paste" },
      { municipio: "Pachuca", diet: "paste" },
      { municipio: "Pachuca", diet: "restaurante" },
      { municipio: "Real del Monte", diet: "paste" },
    ];
    expect(lDiversity(rows, ["municipio", "diet"], "diet", 2).satisfiesL).toBe(false);
  });

  it("acota el riesgo de membresía con la cota estándar ε", () => {
    const risk = membershipRiskBound(1);
    expect(risk).toBeGreaterThan(0);
    expect(risk).toBeLessThan(1);
  });
});
