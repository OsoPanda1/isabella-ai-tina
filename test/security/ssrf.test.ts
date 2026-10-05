import { describe, it, expect, vi } from "vitest";

/**
 * EGRESS ALLOWLIST (test/security/ssrf.test.ts)
 * -----------------------------------------------------------------
 * Anti-SSRF real: solo HTTPS al host Gemini (y VOICE_API_URL
 * configurada). Todo lo demás se rechaza ANTES del fetch.
 */

import { SecuritySystem } from "@/lib/security";

describe("allowlist de egress server-side", () => {
  it("permite el upstream de inferencia", () => {
    expect(
      SecuritySystem.isUpstreamAllowed(
        "https://generativelanguage.googleapis.com/v1beta/models/x:generate",
      ),
    ).toBe(true);
  });

  it("rechaza http, credenciales, hosts ajenos e IPs", () => {
    expect(SecuritySystem.isUpstreamAllowed("http://generativelanguage.googleapis.com/x")).toBe(
      false,
    );
    expect(
      SecuritySystem.isUpstreamAllowed("https://user:pass@generativelanguage.googleapis.com/x"),
    ).toBe(false);
    expect(SecuritySystem.isUpstreamAllowed("https://evil.example.com/hook")).toBe(false);
    expect(SecuritySystem.isUpstreamAllowed("https://169.254.169.254/latest/meta-data")).toBe(
      false,
    );
    expect(SecuritySystem.isUpstreamAllowed("https://127.0.0.1:3000/api/db")).toBe(false);
    expect(SecuritySystem.isUpstreamAllowed("not-a-url")).toBe(false);
    expect(SecuritySystem.isUpstreamAllowed("file:///etc/passwd")).toBe(false);
  });

  it("fetchSafeUpstream lanza antes de red en host no autorizado", async () => {
    await expect(
      SecuritySystem.fetchSafeUpstream("https://evil.example.com/x", {}),
    ).rejects.toThrow(/no autorizado/i);
  });

  it("ISA-184: canonicalizacion estricta de hostname/userinfo/puerto", () => {
    expect(SecuritySystem.isUpstreamAllowed("https://api.groq.com/v1/chat")).toBe(true);
    expect(SecuritySystem.isUpstreamAllowed("https://api.groq.com:443/v1")).toBe(true);
    // trailing dot y puerto no-443 no estan en la allowlist
    expect(SecuritySystem.isUpstreamAllowed("https://api.groq.com./v1")).toBe(false);
    expect(SecuritySystem.isUpstreamAllowed("https://api.groq.com:8443/v1")).toBe(false);
    // percent-encoding en el host no se decodifica a un host permitido
    expect(SecuritySystem.isUpstreamAllowed("https://api.groq%2ecom.evil.example/x")).toBe(false);
    // userinfo con @ pegado al host
    expect(SecuritySystem.isUpstreamAllowed("https://api.groq.com@evil.example.com/x")).toBe(
      false,
    );
    expect(SecuritySystem.isUpstreamAllowed("HTTPS://api.groq.com/x")).toBe(true);
  });

  it("ISA-187: formas IPv4/IPv6/decimal/hex/octal de localhost rechazadas", () => {
    for (const url of [
      "https://[::1]/x",
      "https://[0:0:0:0:0:0:0:1]/x",
      "https://127.0.0.1/x",
      "https://2130706433/x",
      "https://0x7f000001/x",
      "https://0177.0.0.1/x",
      "https://017700000001/x",
      "https://169.254.169.254/latest/meta-data",
      "https://0.0.0.0/x",
    ]) {
      expect(SecuritySystem.isUpstreamAllowed(url), url).toBe(false);
    }
  });

  it("ISA-185: fetchSafeUpstream no sigue redirects y rechaza el destino final", async () => {
    const originalFetch = globalThis.fetch;
    const mockFetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      return Response.redirect("https://evil.example.com/steal", 302);
    });
    globalThis.fetch = mockFetch as unknown as typeof fetch;
    try {
      await expect(
        SecuritySystem.fetchSafeUpstream("https://api.groq.com/v1/chat", {}),
      ).rejects.toThrow(/redireccion/i);
      expect(mockFetch.mock.calls[0]?.[1]?.redirect).toBe("error");
      expect(mockFetch.mock.calls[0]?.[0]).toBe("https://api.groq.com/v1/chat");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
