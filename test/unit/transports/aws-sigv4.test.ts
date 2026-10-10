import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { computeSignature, signRequest, SigV4Error } from "@/lib/intelligence/transports/aws-sigv4";
import type { SigV4Input } from "@/lib/intelligence/transports/aws-sigv4";

/**
 * Contrato del firmante SigV4 (test/unit/transports/aws-sigv4.test.ts)
 * Pruebas de propiedades estructurales deterministas con `date` fijo:
 * misma entrada → misma firma, scope de credenciales, X-Amz-Date derivada de la
 * fecha inyectada, hash del body, sensibilidad a cada campo de entrada,
 * codificación/canonicalización (query ordenado, headers en minúsculas) y
 * manejo de errores tipados. NINGUNA firma se verifica contra AWS en vivo.
 */

const sha256Hex = (data: string): string => createHash("sha256").update(data, "utf8").digest("hex");

const BASE: SigV4Input = {
  method: "POST",
  url: "https://bedrock-runtime.us-east-1.amazonaws.com/model/amazon.titan-text-express-v1/converse",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ model: "amazon.titan-text-express-v1", messages: [] }),
  region: "us-east-1",
  service: "bedrock",
  credentials: {
    accessKeyId: "AKIDEXAMPLE",
    secretAccessKey: "SECRETKEYEXAMPLE",
  },
  date: "2026-01-15T12:00:00Z",
};

const signatureOf = (input: SigV4Input): string => {
  const authorization = signRequest(input).headers.Authorization;
  const parts = authorization.split("Signature=");
  return parts[1] ?? "";
};

describe("signRequest · determinismo y forma", () => {
  it("produce la misma firma ante la misma entrada", () => {
    expect(signRequest(BASE).headers.Authorization).toBe(signRequest(BASE).headers.Authorization);
  });

  it("firma con 64 dígitos hex en minúsculas", () => {
    expect(signatureOf(BASE)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("declara el credential scope completo en Authorization", () => {
    const { Authorization } = signRequest(BASE).headers;

    expect(Authorization.startsWith("AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/")).toBe(true);
    expect(Authorization).toContain("/us-east-1/bedrock/aws4_request");
    expect(Authorization).toContain(
      "SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date",
    );
    expect(Authorization).toContain(
      `Credential=AKIDEXAMPLE/20260115/us-east-1/bedrock/aws4_request`,
    );
  });

  it("refleja la fecha inyectada en X-Amz-Date", () => {
    expect(signRequest(BASE).headers["X-Amz-Date"]).toBe("20260115T120000Z");
  });

  it("envía X-Amz-Content-Sha256 igual al SHA256 del body", () => {
    expect(signRequest(BASE).headers["X-Amz-Content-Sha256"]).toBe(sha256Hex(BASE.body ?? ""));
  });

  it("conserva los headers del caller", () => {
    expect(signRequest(BASE).headers["content-type"]).toBe("application/json");
  });
});

describe("signRequest · sensibilidad de la firma", () => {
  const base = signatureOf(BASE);

  it("cambia al variar body, método, región o service", () => {
    expect(signatureOf({ ...BASE, body: '{"model":"otro"}' })).not.toBe(base);
    expect(signatureOf({ ...BASE, method: "PUT" })).not.toBe(base);
    expect(signatureOf({ ...BASE, region: "eu-west-1" })).not.toBe(base);
    expect(signatureOf({ ...BASE, service: "s3" })).not.toBe(base);
  });

  it("cambia al variar credenciales o fecha", () => {
    expect(
      signatureOf({
        ...BASE,
        credentials: { accessKeyId: "AKIDEXAMPLE", secretAccessKey: "OTRA_CLAVE" },
      }),
    ).not.toBe(base);
    expect(signatureOf({ ...BASE, date: "2026-01-16T12:00:00Z" })).not.toBe(base);
  });
});

describe("signRequest · sessionToken", () => {
  it("añade X-Amz-Security-Token cuando hay sessionToken", () => {
    const signed = signRequest({
      ...BASE,
      credentials: {
        accessKeyId: "AKIDEXAMPLE",
        secretAccessKey: "SECRETKEYEXAMPLE",
        sessionToken: "TOKEN_TEMPORAL",
      },
    });

    expect(signed.headers["X-Amz-Security-Token"]).toBe("TOKEN_TEMPORAL");
  });

  it("no añade X-Amz-Security-Token cuando no hay sessionToken", () => {
    expect(signRequest(BASE).headers).not.toHaveProperty("X-Amz-Security-Token");
  });
});

describe("signRequest · errores tipados", () => {
  it("lanza MISSING_CREDENTIALS sin credenciales", () => {
    expect(() =>
      signRequest({
        ...BASE,
        credentials: { accessKeyId: "", secretAccessKey: "SECRETKEYEXAMPLE" },
      }),
    ).toThrow(/MISSING_CREDENTIALS/);
    expect(() =>
      signRequest({ ...BASE, credentials: { accessKeyId: "", secretAccessKey: "" } }),
    ).toThrow(SigV4Error);
  });

  it("lanza INVALID_URL ante una URL no parseable o con protocolo inválido", () => {
    expect(() => signRequest({ ...BASE, url: "no-es-una-url" })).toThrow(/INVALID_URL/);
    expect(() => signRequest({ ...BASE, url: "ftp://ejemplo.com/x" })).toThrow(/INVALID_URL/);
  });

  it("lanza INVALID_DATE ante una fecha no parseable", () => {
    expect(() => signRequest({ ...BASE, date: "fecha-invalida" })).toThrow(/INVALID_DATE/);
  });

  it("lanza INVALID_REGION e INVALID_SERVICE vacíos", () => {
    expect(() => signRequest({ ...BASE, region: "" })).toThrow(/INVALID_REGION/);
    expect(() => signRequest({ ...BASE, service: "" })).toThrow(/INVALID_SERVICE/);
  });
});

describe("computeSignature · canonical request", () => {
  it("ordena los query params y firma igual sin importar su orden en la URL", () => {
    const desc = computeSignature({ ...BASE, url: `${BASE.url}?b=2&a=1` });
    const asc = computeSignature({ ...BASE, url: `${BASE.url}?a=1&b=2` });

    expect(asc.signature).toBe(desc.signature);
    const lines = desc.canonicalRequest.split("\n");
    expect(lines[0]).toBe("POST");
    expect(lines[1]).toBe("/model/amazon.titan-text-express-v1/converse");
    expect(lines[2]).toBe("a=1&b=2");
  });

  it("canonicaliza headers en minúsculas, ordenados y recortados", () => {
    const material = computeSignature({
      ...BASE,
      headers: { "Content-Type": "  application/json  " },
    });
    const lines = material.canonicalRequest.split("\n");

    expect(lines.slice(3, 7)).toEqual([
      "content-type:application/json",
      "host:bedrock-runtime.us-east-1.amazonaws.com",
      `x-amz-content-sha256:${sha256Hex(BASE.body ?? "")}`,
      "x-amz-date:20260115T120000Z",
    ]);
    expect(lines[7]).toBe("");
    expect(lines[8]).toBe("content-type;host;x-amz-content-sha256;x-amz-date");
    expect(lines[9]).toBe(sha256Hex(BASE.body ?? ""));
  });

  it("firma igual con el header en otra capitalización", () => {
    const lower = computeSignature({ ...BASE, headers: { "content-type": "application/json" } });
    const pascal = computeSignature({ ...BASE, headers: { "Content-Type": "application/json" } });

    expect(pascal.signature).toBe(lower.signature);
  });

  it("el string-to-sign encadena algoritmo, fecha, scope y hash del canonical request", () => {
    const material = computeSignature(BASE);
    const lines = material.stringToSign.split("\n");

    expect(lines[0]).toBe("AWS4-HMAC-SHA256");
    expect(lines[1]).toBe("20260115T120000Z");
    expect(lines[2]).toBe("20260115/us-east-1/bedrock/aws4_request");
    expect(material.credentialScope).toBe("20260115/us-east-1/bedrock/aws4_request");
    expect(material.stringToSign).toContain(sha256Hex(material.canonicalRequest));
  });
});
