import { describe, expect, it } from "vitest";
import {
  buildTimestampRequest,
  createImprintOnlyTsaVerifier,
  createRfc3161TsaClient,
  decodeOid,
  decodeTimestampResponse,
  der,
  digestHex,
  readDer,
} from "@/lib/igds";

const SHA256_OID = "2.16.840.1.101.3.4.2.1";
const TST_INFO_OID = "1.2.840.113549.1.9.16.1.4";
const SIGNED_DATA_OID = "1.2.840.113549.1.7.2";

function syntheticResponse(input: {
  digestHexValue: string;
  status?: number;
  policy?: string;
  genTime?: string;
  serialHex?: string;
}): Buffer {
  const imprint = der.encodeSequence([
    der.encodeSequence([der.encodeOid(SHA256_OID), der.tlv(0x05, Buffer.alloc(0))]),
    der.encodeOctetString(Buffer.from(input.digestHexValue, "hex")),
  ]);
  const tstInfo = der.encodeSequence([
    der.encodeIntegerNumber(1),
    der.encodeOid(input.policy ?? "1.2.3.4.5"),
    imprint,
    der.encodeUnsignedInteger(Buffer.from(input.serialHex ?? "0badf00d", "hex")),
    der.toGeneralizedTime(new Date(input.genTime ?? "2026-09-17T20:03:11Z")),
  ]);
  const encap = der.encodeSequence([
    der.encodeOid(TST_INFO_OID),
    der.encodeExplicit(0, der.encodeOctetString(tstInfo)),
  ]);
  const signedData = der.encodeSequence([
    der.encodeIntegerNumber(3),
    der.tlv(0x31, der.encodeSequence([der.encodeOid(SHA256_OID), der.tlv(0x05, Buffer.alloc(0))])),
    encap,
  ]);
  const contentInfo = der.encodeSequence([
    der.encodeOid(SIGNED_DATA_OID),
    der.encodeExplicit(0, signedData),
  ]);
  const statusInfo = der.encodeSequence([der.encodeIntegerNumber(input.status ?? 0)]);
  return der.encodeSequence([statusInfo, contentInfo]);
}

describe("IGDS RFC 3161 — DER", () => {
  it("construye un TimeStampReq sha256 con nonce y certReq", () => {
    const digest = digestHex("sha256", "sello");
    const request = buildTimestampRequest(digest, {
      nonce: Buffer.from("0011223344556677", "hex"),
    });
    const root = readDer(request).node;
    expect(root.tag).toBe(0x30);
    expect(root.children).toHaveLength(4);
    expect(root.children[0]!.bytes[0]).toBe(1);
    const imprint = root.children[1]!;
    expect(imprint.tag).toBe(0x30);
    expect(decodeOid(imprint.children[0]!.children[0]!.bytes)).toBe(SHA256_OID);
    expect(Buffer.from(imprint.children[1]!.bytes).toString("hex")).toBe(digest);
    expect(root.children[3]!.tag).toBe(0x01);
  });

  it("decodifica una respuesta concedida y extrae el token", () => {
    const digest = digestHex("sha256", "contenido sellado");
    const response = syntheticResponse({ digestHexValue: digest });
    const decoded = decodeTimestampResponse(response, digest);
    expect(decoded.granted).toBe(true);
    expect(decoded.token?.message_imprint.value).toBe(digest);
    expect(decoded.token?.policy).toBe("1.2.3.4.5");
    expect(decoded.token?.gen_time).toBe("2026-09-17T20:03:11.000Z");
    expect(decoded.token?.serial_number).toBe("0badf00d");
    expect(decoded.token?.encoded_timestamp_token.length).toBeGreaterThan(0);
  });

  it("rechaza respuestas no concedidas", () => {
    const digest = digestHex("sha256", "x");
    const response = syntheticResponse({ digestHexValue: digest, status: 2 });
    const decoded = decodeTimestampResponse(response);
    expect(decoded.granted).toBe(false);
    expect(decoded.status).toBe(2);
  });

  it("rechaza un token que no cubre el digest solicitado", () => {
    const response = syntheticResponse({ digestHexValue: digestHex("sha256", "otro") });
    expect(() => decodeTimestampResponse(response, digestHex("sha256", "esperado"))).toThrow(
      /no cubre el digest/,
    );
  });
});

describe("IGDS RFC 3161 — cliente y verificador", () => {
  it("usa el transporte inyectado y el verificador de imprint", async () => {
    const digest = digestHex("sha256", "informe");
    const response = syntheticResponse({ digestHexValue: digest });
    const fetchImpl = (async () =>
      new Response(new Uint8Array(response), {
        status: 200,
        headers: { "content-type": "application/timestamp-reply" },
      })) as unknown as typeof fetch;

    const client = createRfc3161TsaClient({
      url: "https://tsa.example/rfc3161",
      fetchImpl,
    });
    const token = await client.timestamp(digest);
    expect(token.message_imprint.value).toBe(digest);

    const verifier = createImprintOnlyTsaVerifier();
    expect(await verifier.verify(token, digest)).toBe(true);
    expect(await verifier.verify(token, digestHex("sha256", "alterado"))).toBe(false);
  });

  it("falla cerrado ante HTTP no exitoso", async () => {
    const fetchImpl = (async () =>
      new Response("nope", { status: 503 })) as unknown as typeof fetch;
    const client = createRfc3161TsaClient({ url: "https://tsa.example/rfc3161", fetchImpl });
    await expect(client.timestamp(digestHex("sha256", "x"))).rejects.toThrow(/HTTP 503/);
  });
});
