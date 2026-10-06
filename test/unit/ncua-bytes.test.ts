import { describe, expect, it } from "vitest";

import {
  encodeUtf8,
  decodeUtf8,
  byteLengthOf,
  isValidUtf8Roundtrip,
  fnv1a,
  chunkBytes,
} from "@/lib/ncua/bytes";

describe("ncua:bytes (alfabeto de 256, sin tokens)", () => {
  it("codifica y decodifica UTF-8 con roundtrip exacto", () => {
    const text = "Real del Monte, Hidalgo: paste minero, plata 925, acueducto y pastelería.";
    expect(byteLengthOf(text)).toBeGreaterThan(text.length);
    expect(isValidUtf8Roundtrip(text)).toBe(true);
    const encoded = encodeUtf8(text);
    expect(decodeUtf8(encoded)).toBe(text);
  });

  it("detecta secuencias UTF-8 inválidas (secuencia truncada)", () => {
    const valid = decodeUtf8(new Uint8Array([0x23]));
    expect(valid).toBe("#");
    const invalid = new Uint8Array([0x80, 0x80]);
    expect(() => decodeUtf8(invalid)).not.toThrow();
  });

  it("fnv1a es determinista y sensible a la entrada", () => {
    const a = fnv1a(encodeUtf8("paste"));
    const b = fnv1a(encodeUtf8("paste"));
    const c = fnv1a(encodeUtf8("past"));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("particiona bytes en chunks sin perder datos", () => {
    const text = "sistema soberano de comprensión continua nativa";
    const chunks = chunkBytes(encodeUtf8(text), 8);
    const concatenated = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
    let offset = 0;
    for (const chunk of chunks) {
      concatenated.set(chunk, offset);
      offset += chunk.length;
    }
    expect(decodeUtf8(concatenated)).toBe(text);
  });
});
