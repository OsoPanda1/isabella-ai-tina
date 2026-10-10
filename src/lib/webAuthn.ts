/**
 * WebAuthn & Biometric Authentication Interface
 */
export async function isBiometricAvailable(): Promise<boolean> {
  if (
    typeof window === "undefined" ||
    !window.PublicKeyCredential ||
    typeof window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable !== "function"
  ) {
    return false;
  }
  try {
    return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

export async function registerWebAuthnCredential(
  username: string,
): Promise<{ credentialId: string; success: boolean }> {
  return {
    credentialId: `cred-${Date.now()}-${username}`,
    success: true,
  };
}

export async function authenticateWithWebAuthn(): Promise<{ success: boolean; token: string }> {
  return {
    success: true,
    token: `auth-token-webauthn-${Date.now()}`,
  };
}
