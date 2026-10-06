import { describe, expect, it } from "vitest";

import { runNativePipeline, getMemoryIndexForScope } from "@/lib/ncua/pipeline";
import { createNativeEngine } from "@/lib/ncua";

describe("ncua:pipeline soberano de 12 pasos", () => {
  const memoryCorpus = [
    {
      id: "mem-1",
      text: "El paste fue traído por los mineros córnico-alemanes a Real del Monte.",
    },
    {
      id: "mem-2",
      text: "La Mina de Acosta es un museo de sitio en Pachuca, Hidalgo.",
    },
  ];
  const signer = (payload: string) => `sig:${payload.length}`;

  it("ejecuta los 12 pasos con cadena de auditoría encadenada", () => {
    const result = runNativePipeline("¿qué es el paste?", {
      productionLike: false,
      hasProvider: false,
      memoryCorpus,
      signer,
    });
    expect(result.numberOfSteps).toBe(12);
    expect(result.chain.length).toBe(12);
    let prev = "";
    for (const record of result.chain) {
      expect(record.prevHash).toBe(prev);
      prev = record.hash;
    }
    expect(result.aligned).toBe(true);
  });

  it("rechaza con 503 en producción sin proveedor (sin sustituto generativo)", () => {
    const result = runNativePipeline("¿qué es el paste?", {
      productionLike: true,
      hasProvider: false,
    });
    expect(result.inference.mode).toBe("MAINTENANCE");
    expect(result.httpStatus).toBe(503);
    expect(result.response).toBeNull();
  });

  it("declara modo nativo y degradado en desarrollo sin proveedor", () => {
    const result = runNativePipeline("¿qué es el paste?", {
      productionLike: false,
      hasProvider: false,
    });
    expect(result.inference.mode).toBe("NATIVE_DECLARED");
    expect(result.inference.degraded).toBe(true);
    expect(result.response).not.toBeNull();
  });

  it("en producción con proveedor pasa a PRODUCTION_NORMAL", () => {
    const result = runNativePipeline("¿qué es el paste?", {
      productionLike: true,
      hasProvider: true,
    });
    expect(result.inference.mode).toBe("PRODUCTION_NORMAL");
    expect(result.httpStatus).toBe(200);
  });

  it("detecta riesgo y niega respuesta sin persistir datos", () => {
    const result = runNativePipeline("mi correo es alguien@example.com", {
      productionLike: false,
      hasProvider: false,
    });
    expect(result.riskDetected).toBe(true);
    expect(result.response).toContain("rechazada");
  });

  it("consenso y atención federada quedan auditables en la salida", () => {
    const result = runNativePipeline("museo de sitio de la minería en Pachuca", {
      productionLike: false,
      hasProvider: false,
      memoryCorpus,
      tenantId: "tenant-a",
      attestations: {
        principalPresent: true,
        tenantBoundaryOk: true,
        authorshipApproved: true,
        sandboxAllowed: true,
      },
    });
    expect(result.federations.approveVotes).toBeGreaterThanOrEqual(0);
    expect(result.federations.vetoActive).toBe(false);
    expect(result.attention).toBeDefined();
    expect(result.memory).toBeDefined();
    expect(result.metrics?.corpusSize).toBe(2);
  });

  it("sin atestaciones verificadas no afirma identidad, política ni sandbox (fail-closed)", () => {
    const result = runNativePipeline("museo de sitio de la minería en Pachuca", {
      productionLike: false,
      hasProvider: false,
      memoryCorpus,
      tenantId: "tenant-unknown",
    });
    expect(result.attestations).toEqual({
      principalPresent: false,
      tenantBoundaryOk: false,
      authorshipApproved: false,
      sandboxAllowed: false,
      capabilityTokenPresent: false,
    });
    expect(result.federations.vetoActive).toBe(true);
    expect(result.federations.votesApproved).toBe(false);
    const federationStep = result.chain.find((record) => record.stepName === "heptafederación");
    expect(federationStep?.data).toMatchObject({
      attestations: { principalPresent: false, tenantBoundaryOk: false },
    });
  });

  it("aisla el índice de memoria por scope de tenant", () => {
    const tenantA = getMemoryIndexForScope("tenant-a", memoryCorpus);
    const tenantAAgain = getMemoryIndexForScope("tenant-a", memoryCorpus);
    const tenantB = getMemoryIndexForScope("tenant-b", memoryCorpus);
    expect(tenantA).toBeDefined();
    expect(tenantAAgain).toBe(tenantA);
    expect(tenantB).not.toBe(tenantA);
  });

  it("integra el motor nativo para recuperación y fundamentación", () => {
    const engine = createNativeEngine(memoryCorpus);
    expect(engine.lsh.size).toBe(2);
    expect(engine.knowledgeGraph.size).toBeGreaterThan(0);
    expect(engine.intent.size).toBeGreaterThan(0);
  });
});
