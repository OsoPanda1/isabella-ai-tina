import { describe, it, expect, beforeEach } from "vitest";
import {
  NcuaProtocolEngine,
  CreateNcuaOperationSchema,
  SubmitNcuaApprovalSchema,
} from "@/lib/ncua/ncua-protocol";
import { doublePipeline } from "@/lib/isabella/double-pipeline";

describe("NCUA 2-de-3 Protocol Engine & Quorum Verification", () => {
  const testTenant = "tenant-genesis-test";
  const testUser = "user-auditor-1";

  beforeEach(() => {
    // Inicialización limpia
  });

  it("crea una operación NCUA con nonce, hashes de payload y política CROWN", () => {
    const payload = { action: "rebalance_reserve", amount: 50000 };
    const op = NcuaProtocolEngine.createOperation({
      tenantId: testTenant,
      userId: testUser,
      operation: "vault.sovereign.transfer",
      category: "financial",
      payload,
      ttlMinutes: 10,
    });

    expect(op.id).toMatch(/^op_/);
    expect(op.tenantId).toBe(testTenant);
    expect(op.status).toBe("pending");
    expect(op.quorum).toBe("2-de-3");
    expect(op.requiredApprovals).toBe(2);
    expect(op.approvals).toHaveLength(0);
    expect(op.payloadHash).toBeDefined();
    expect(op.policyHash).toBeDefined();
    expect(op.nonce).toBeDefined();
  });

  it("valida el esquema CreateNcuaOperationSchema correctamente", () => {
    const valid = CreateNcuaOperationSchema.safeParse({
      operation: "system.maintenance.gate",
      category: "governance",
      payload: { mode: "active" },
      ttlMinutes: 15,
    });
    expect(valid.success).toBe(true);

    const invalid = CreateNcuaOperationSchema.safeParse({
      operation: "",
      category: "unknown_category",
    });
    expect(invalid.success).toBe(false);
  });

  it("acumula firmas de nodos soberanos y aprueba al alcanzar quorum 2-de-3", () => {
    const op = NcuaProtocolEngine.createOperation({
      tenantId: testTenant,
      userId: testUser,
      operation: "cryptographic.rekey",
      category: "cryptographic",
      payload: { target: "pqc-kem" },
      ttlMinutes: 5,
    });

    // Aprobación 1: Nodo A (CROWN)
    const step1 = NcuaProtocolEngine.submitApproval({
      operationId: op.id,
      tenantId: testTenant,
      node: "node_a_crown",
      decision: "approve",
      reason: "Constitutional integrity verified",
    });

    expect(step1.operation.status).toBe("pending");
    expect(step1.operation.approvals).toHaveLength(1);
    expect(step1.evidence).toBeNull(); // Aún no hay quórum

    // Aprobación 2: Nodo B (SOPHIA) -> Alcanza quórum (2 de 3)
    const step2 = NcuaProtocolEngine.submitApproval({
      operationId: op.id,
      tenantId: testTenant,
      node: "node_b_sophia",
      decision: "approve",
      reason: "Epistemic proof validated",
    });

    expect(step2.operation.status).toBe("approved");
    expect(step2.operation.approvals).toHaveLength(2);
    expect(step2.evidence).toBeDefined();
    expect(step2.evidence?.evidenceStatus).toBe("E3");
    expect(step2.evidence?.merkleRoot).toBeDefined();
    expect(step2.evidence?.participatingNodes).toHaveLength(2);
    expect(step2.evidence?.quorumReached).toBe(true);
  });

  it("rechaza firmas duplicadas del mismo nodo para prevenir replay o manipulación", () => {
    const op = NcuaProtocolEngine.createOperation({
      tenantId: testTenant,
      userId: testUser,
      operation: "security.veto",
      category: "system_critical",
      payload: { reason: "high_anomaly" },
      ttlMinutes: 5,
    });

    NcuaProtocolEngine.submitApproval({
      operationId: op.id,
      tenantId: testTenant,
      node: "node_c_argus",
      decision: "approve",
    });

    expect(() => {
      NcuaProtocolEngine.submitApproval({
        operationId: op.id,
        tenantId: testTenant,
        node: "node_c_argus",
        decision: "approve",
      });
    }).toThrow(/ya ha emitido/);
  });

  it("valida el esquema SubmitNcuaApprovalSchema correctamente", () => {
    const valid = SubmitNcuaApprovalSchema.safeParse({
      operationId: "ncua_op_12345678",
      node: "node_a_crown",
      decision: "approve",
      reason: "Audit check pass",
    });
    expect(valid.success).toBe(true);

    const invalid = SubmitNcuaApprovalSchema.safeParse({
      operationId: "",
      node: "invalid_node",
      decision: "maybe",
    });
    expect(invalid.success).toBe(false);
  });
});

describe("Doble Pipeline Hexagonal Latency & Benchmarks", () => {
  it("enruta operaciones y produce métricas de percentiles p50, p95 y p99", async () => {
    const { result, metrics } = await doublePipeline.route(
      async () => {
        return { success: true, computeId: 42 };
      },
      { A: 0.99, B: 0.98, latencyA: 2.1, latencyB: 3.5 },
      { tenantId: "test-tenant", input: "benchmark-test-sample" },
    );

    expect(result.success).toBe(true);
    expect(metrics.p50).toBeGreaterThan(0);
    expect(metrics.p95).toBeGreaterThan(0);
    expect(metrics.p99).toBeGreaterThan(0);
    expect(metrics.portBreakdown.Ingest).toBeDefined();
    expect(metrics.portBreakdown.Policy).toBeDefined();
    expect(metrics.portBreakdown.Context).toBeDefined();
    expect(metrics.portBreakdown.Inference).toBeDefined();
    expect(metrics.portBreakdown.Evidence).toBeDefined();
    expect(metrics.portBreakdown.Delivery).toBeDefined();
  });

  it("ejecuta benchmark real y actualiza historial en snapshot", async () => {
    const snapBefore = doublePipeline.getSnapshot();
    const snapAfter = await doublePipeline.runBenchmark(2);

    expect(snapAfter.history.length).toBeGreaterThanOrEqual(snapBefore.history.length);
    expect(snapAfter.metricsA.p50).toBeGreaterThan(0);
    expect(snapAfter.metricsB.p50).toBeGreaterThan(0);
  });
});
