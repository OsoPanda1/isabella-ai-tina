import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPublicKey, generateKeyPairSync, sign, verify, type KeyObject } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ATTESTATION_ALGORITHM,
  ATTESTATION_SLOTS,
  assertIsabellaAttestationsVerified,
  describeAttestationReport,
  verifyAttestationSlot,
  verifyIsabellaAttestations,
} from "@/lib/signatures/attestation.server";

/**
 * Contrato de atestación (test/unit/attestation-signature.test.ts)
 * ----------------------------------------------------------------
 * Firma = RSA-2048 / SHA-256 / PKCS#1 v1.5 sobre los bytes UTF-8 exactos.
 * Tres piezas deben coincidir: firma (env) + clave pública PEM + payload.
 * Cualquier pieza ausente o alterada => NO VERIFIED (fail-closed).
 */

const PAYLOAD = Buffer.from("Mensaje confidencial o payload", "utf8");

let dir: string;
let publicKey: KeyObject;
let publicKeyPem: string;
let goodSignature: string;

function writeSlot(slot: number, options: { pub?: string | null; payload?: Buffer | null }): void {
  const pubPath = join(dir, `${slot}.pub.pem`);
  const payloadPath = join(dir, `${slot}.payload.txt`);
  if (existsSync(pubPath)) unlinkSync(pubPath);
  if (existsSync(payloadPath)) unlinkSync(payloadPath);
  if (options.pub !== null && options.pub !== undefined) writeFileSync(pubPath, options.pub);
  if (options.payload !== null && options.payload !== undefined)
    writeFileSync(payloadPath, options.payload);
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "isabella-attestation-"));
  const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  publicKey = pair.publicKey;
  publicKeyPem = pair.publicKey.export({ type: "spki", format: "pem" }).toString();
  goodSignature = sign("sha256", PAYLOAD, pair.privateKey).toString("base64");
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("contrato criptográfico de atestación", () => {
  it("declara RSA-2048 / SHA-256 / PKCS#1 v1.5", () => {
    expect(ATTESTATION_ALGORITHM).toEqual({
      keyType: "RSA",
      modulusBits: 2048,
      hash: "sha256",
      scheme: "PKCS1-v1_5",
    });
    expect(ATTESTATION_SLOTS).toEqual([1, 2, 3]);
    expect(publicKey.asymmetricKeyType).toBe("rsa");
    expect(publicKey.asymmetricKeyDetails?.modulusLength).toBe(2048);
  });

  it("verifica la firma correcta contra la clave pública y el payload exactos", () => {
    writeSlot(1, { pub: publicKeyPem, payload: PAYLOAD });
    const report = verifyAttestationSlot(1, { dir, signature: goodSignature });
    expect(report.status).toBe("VERIFIED");
    expect(report.signatureFingerprint).toMatch(/^sha256:[0-9a-f]{32}$/);
    expect(report.publicKeyFingerprint).toMatch(/^sha256:[0-9a-f]{32}$/);
  });

  it("rechaza un payload alterado (SIGNATURE_MISMATCH)", () => {
    writeSlot(2, { pub: publicKeyPem, payload: Buffer.from("Mensaje confidencial", "utf8") });
    const report = verifyAttestationSlot(2, { dir, signature: goodSignature });
    expect(report.status).toBe("SIGNATURE_MISMATCH");
  });

  it("rechaza una clave pública ajena (SIGNATURE_MISMATCH)", () => {
    const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
    writeSlot(3, {
      pub: other.publicKey.export({ type: "spki", format: "pem" }).toString(),
      payload: PAYLOAD,
    });
    const report = verifyAttestationSlot(3, { dir, signature: goodSignature });
    expect(report.status).toBe("SIGNATURE_MISMATCH");
  });

  it("rechaza una firma corrupta o de otro algoritmo", () => {
    writeSlot(4, { pub: publicKeyPem, payload: PAYLOAD });
    const report = verifyAttestationSlot(4, { dir, signature: Buffer.alloc(256).toString("base64") });
    expect(report.status).toBe("SIGNATURE_MISMATCH");
  });

  it("queda NO VERIFICADA sin clave pública (MISSING_PUBLIC_KEY)", () => {
    writeSlot(5, { pub: null, payload: PAYLOAD });
    expect(verifyAttestationSlot(5, { dir, signature: goodSignature }).status).toBe(
      "MISSING_PUBLIC_KEY",
    );
  });

  it("queda NO VERIFICADA sin payload (MISSING_PAYLOAD)", () => {
    writeSlot(6, { pub: publicKeyPem, payload: null });
    expect(verifyAttestationSlot(6, { dir, signature: goodSignature }).status).toBe(
      "MISSING_PAYLOAD",
    );
  });

  it("queda NO VERIFICADA sin firma (MISSING_SIGNATURE)", () => {
    writeSlot(7, { pub: publicKeyPem, payload: PAYLOAD });
    expect(verifyAttestationSlot(7, { dir, signature: "   " }).status).toBe("MISSING_SIGNATURE");
  });

  it("distingue clave pública corrupta de clave ausente", () => {
    writeSlot(8, { pub: "esto-no-es-un-pem", payload: PAYLOAD });
    expect(verifyAttestationSlot(8, { dir, signature: goodSignature }).status).toBe(
      "INVALID_PUBLIC_KEY",
    );
  });

  it("marca NOT_CONFIGURED cuando no hay evidencia alguna", () => {
    writeSlot(9, { pub: null, payload: null });
    const report = verifyAttestationSlot(9, { dir, signature: undefined });
    expect(report.status).toBe("NOT_CONFIGURED");
    expect(report.signatureFingerprint).toBeNull();
    expect(report.publicKeyFingerprint).toBeNull();
  });

  it("tolera saltos de línea en el base64 pero exige el mismo digest", () => {
    writeSlot(10, { pub: publicKeyPem, payload: PAYLOAD });
    const wrapped = goodSignature.replace(/(.{60})/g, "$1\n").trim();
    expect(verifyAttestationSlot(10, { dir, signature: wrapped }).status).toBe("VERIFIED");
  });
});

describe("reporte global de atestaciones (fail-closed)", () => {
  it("sin ninguna ranura configurada no hay PASS", () => {
    const report = verifyIsabellaAttestations({ dir: join(dir, "empty") });
    expect(report.verified).toBe(false);
    expect(report.configured).toBe(0);
    expect(report.verifiedCount).toBe(0);
  });

  it("una sola ranura sin verificar invalida el reporte completo", () => {
    writeSlot(1, { pub: publicKeyPem, payload: PAYLOAD });
    // Ranura 2: hay material en disco pero falta la firma => configurada y NO verificada.
    writeSlot(2, { pub: publicKeyPem, payload: PAYLOAD });
    writeSlot(3, { pub: null, payload: null });
    const report = verifyIsabellaAttestations({
      dir,
      signatures: { 1: goodSignature, 2: "", 3: "" },
    });
    expect(report.slots[0].status).toBe("VERIFIED");
    expect(report.slots[1].status).toBe("MISSING_SIGNATURE");
    expect(report.slots[2].status).toBe("NOT_CONFIGURED");
    expect(report.configured).toBe(2);
    expect(report.verifiedCount).toBe(1);
    expect(report.verified).toBe(false);
  });

  it("solo las ranuras configuradas cuentan para el veredicto", () => {
    writeSlot(2, { pub: null, payload: null });
    writeSlot(3, { pub: null, payload: null });
    const report = verifyIsabellaAttestations({ dir, signatures: { 1: goodSignature } });
    expect(report.configured).toBe(1);
    expect(report.verifiedCount).toBe(1);
    expect(report.verified).toBe(true);
  });

  it("assertIsabellaAttestationsVerified lanza cuando falta evidencia", () => {
    writeSlot(2, { pub: null, payload: null });
    writeSlot(3, { pub: null, payload: null });
    expect(() =>
      assertIsabellaAttestationsVerified(),
    ).toThrowError(/ATTESTATION_NOT_VERIFIED/);
  });

  it("describeAttestationReport no filtra secretos ni payloads", () => {
    writeSlot(1, { pub: publicKeyPem, payload: PAYLOAD });
    const report = verifyIsabellaAttestations({ dir, signatures: { 1: goodSignature } });
    const text = describeAttestationReport(report);
    expect(text).not.toContain(goodSignature);
    expect(text).not.toContain(PAYLOAD.toString("utf8"));
    expect(text).not.toContain("PRIVATE KEY");
    expect(text).toContain("ranura 1: VERIFIED");
  });

  it("el reporte de error de assert no expone la firma", () => {
    let message = "";
    try {
      assertIsabellaAttestationsVerified();
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(/ATTESTATION_NOT_VERIFIED/);
    expect(message).not.toContain(goodSignature);
  });
});

describe("equivalencia con la firma PowerShell RSA-SHA256-PKCS1", () => {
  it("crypto.verify('sha256') valida firmas RSASignaturePadding.Pkcs1", () => {
    // .NET SignData(SHA256, Pkcs1) equivale a crypto.sign("sha256", ...) en RSA.
    const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const data = Buffer.from("Mensaje confidencial o payload", "utf8");
    const signature = sign("sha256", data, pair.privateKey);
    expect(signature.length).toBe(256); // 2048 bits = 256 bytes
    expect(verify("sha256", data, pair.publicKey, signature)).toBe(true);
    expect(
      verify(
        "sha256",
        data,
        createPublicKey(pair.publicKey.export({ type: "spki", format: "pem" }).toString()),
        signature,
      ),
    ).toBe(true);
    // Alterar un solo byte del payload rompe la verificación.
    expect(verify("sha256", Buffer.from("otro payload", "utf8"), pair.publicKey, signature)).toBe(
      false,
    );
  });
});
