/**
 * OIDC Key Utilities (src/lib/oidc.ts)
 * -------------------------------------------------------------
 * Converts JSON Web Keys (JWK) from OIDC discovery / JWKS endpoints
 * to PEM format for cryptographic verification.
 */
import { createPublicKey } from "node:crypto";

export function jwkToPem(jwk: Record<string, unknown>): string {
  try {
    const keyObject = createPublicKey({
      key: jwk as any,
      format: "jwk",
    });
    return keyObject.export({ format: "pem", type: "spki" }) as string;
  } catch (error) {
    throw new Error(
      `Failed to convert JWK to PEM: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export default { jwkToPem };
