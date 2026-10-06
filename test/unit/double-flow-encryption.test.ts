import { describe, expect, it } from "vitest";
import {
  decryptFlow1,
  decryptFlow2,
  encryptFlow1,
  encryptFlow2,
} from "@/lib/crypto/double-flow-encryption";

const secret = "a-production-secret-with-at-least-32-bytes";

describe("double-flow encryption", () => {
  it("round-trips the AES flow and rejects tampering", () => {
    const envelope = encryptFlow1("territorial decision", secret);
    expect(decryptFlow1(envelope, secret)).toBe("territorial decision");
    expect(() =>
      decryptFlow1({ ...envelope, ciphertext: `${envelope.ciphertext}x` }, secret),
    ).toThrow("envelope_integrity_failed");
  });

  it("round-trips the ChaCha flow and rejects the wrong algorithm", () => {
    const envelope = encryptFlow2("auditable payload", secret);
    expect(decryptFlow2(envelope, secret)).toBe("auditable payload");
    expect(() => decryptFlow1(envelope, secret)).toThrow("wrong_flow_algorithm");
  });
});
