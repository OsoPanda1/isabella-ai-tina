import { afterEach, describe, expect, it } from "vitest";

/**
 * DENEGACION SSRF INDEPENDIENTE DE LA ALLOWLIST
 * (test/security/ssrf-deny.test.ts)
 * -----------------------------------------------------------------
 * Un host denegado (IMDS, loopback, RFC1918, CGNAT, link-local/ULA,
 * sufijo interno) se rechaza ANTES y sin importar la allowlist estatica
 * ni los hosts derivados de configuracion.
 */

import { SecuritySystem, isAllowedExternalUrl } from "@/lib/security";
import {
  SSRF_DENIED_CIDRS,
  isSsrfDeniedHost,
  isSsrfDeniedUrl,
} from "@/lib/security/ssrf-deny";
import { config, resetConfigCache } from "@/lib/config";

const mutatedEnvKeys: string[] = [];

function setEnv(key: string, value: string): void {
  mutatedEnvKeys.push(key);
  process.env[key] = value;
  resetConfigCache();
}

afterEach(() => {
  for (const key of mutatedEnvKeys.splice(0)) delete process.env[key];
  resetConfigCache();
});

describe("ssrf-deny: CIDRs y hostnames", () => {
  it("los CIDRs declarados se parsean al importar el modulo", () => {
    expect(SSRF_DENIED_CIDRS.length).toBeGreaterThan(8);
    expect(() => isSsrfDeniedHost("8.8.8.8")).not.toThrow();
  });

  it("deniega IMDS, loopback, RFC1918, CGNAT y 0.0.0.0/8", () => {
    for (const host of [
      "169.254.169.254",
      "169.254.169.250",
      "127.0.0.1",
      "127.1.2.3",
      "10.0.0.1",
      "10.255.255.255",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "100.64.0.1",
      "100.127.255.255",
      "198.18.0.1",
      "0.0.0.0",
    ]) {
      expect(isSsrfDeniedHost(host), host).toBe(true);
    }
  });

  it("deniega IPv6 loopback, link-local, ULA y v4-mapped", () => {
    for (const host of [
      "::1",
      "[::1]",
      "0:0:0:0:0:0:0:1",
      "fe80::1",
      "[fe80::1%eth0]",
      "fc00::1",
      "fd12:3456::1",
      "::ffff:169.254.169.254",
      "[::ffff:169.254.169.254]",
      "::ffff:127.0.0.1",
    ]) {
      expect(isSsrfDeniedHost(host), host).toBe(true);
    }
  });

  it("deniega localhost y sufijos internos", () => {
    for (const host of [
      "localhost",
      "LOCALHOST",
      "metadata.google.internal",
      "intranet.local",
      "printer.local",
      "app.localhost",
      "localhost.",
    ]) {
      expect(isSsrfDeniedHost(host), host).toBe(true);
    }
  });

  it("NO deniega hosts publicos ni IPs fuera de los rangos", () => {
    for (const host of [
      "api.groq.com",
      "generativelanguage.googleapis.com",
      "bedrock-runtime.us-east-1.amazonaws.com",
      "8.8.8.8",
      "1.1.1.1",
      "11.0.0.1",
      "172.15.0.1",
      "172.32.0.1",
      "192.169.0.1",
      "169.255.0.1",
      "100.63.0.1",
      "100.128.0.1",
      "2606:4700:4700::1111",
    ]) {
      expect(isSsrfDeniedHost(host), host).toBe(false);
    }
  });

  it("isSsrfDeniedUrl evalua el hostname y es fail-closed con URL invalida", () => {
    expect(isSsrfDeniedUrl("https://169.254.169.254/latest/meta-data/")).toBe(true);
    expect(isSsrfDeniedUrl("https://api.stripe.com/v1")).toBe(false);
    expect(isSsrfDeniedUrl("not a url")).toBe(true);
  });
});

describe("ssrf-deny aplicado antes de la allowlist", () => {
  it("isUpstreamAllowed rechaza hosts denegados aun si la config los permite", () => {
    setEnv("VOICE_API_URL", "https://voice.metadata.internal");
    expect(config().VOICE_API_URL).toBe("https://voice.metadata.internal");
    // Sin la denegacion explicita, el host derivado de configuracion
    // habria sido aceptado por UPSTREAM_ALLOWLIST/config match.
    expect(SecuritySystem.isUpstreamAllowed("https://voice.metadata.internal/v1")).toBe(false);
    expect(SecuritySystem.isUpstreamAllowed("https://169.254.169.254/latest/meta-data")).toBe(
      false,
    );
    expect(SecuritySystem.isUpstreamAllowed("https://[::1]/x")).toBe(false);
    // La allowlist sigue funcionando para los upstream legitimos.
    expect(SecuritySystem.isUpstreamAllowed("https://api.anthropic.com/v1/messages")).toBe(true);
    expect(
      SecuritySystem.isUpstreamAllowed(
        "https://generativelanguage.googleapis.com/v1beta/models/x:generate",
      ),
    ).toBe(true);
  });

  it("isAllowedExternalUrl denieca sufijos internos aun fuera de production", () => {
    expect(isAllowedExternalUrl("https://api.internal.svc/x")).toBe(false);
    expect(isAllowedExternalUrl("https://printer.local/x")).toBe(false);
    expect(isAllowedExternalUrl("https://169.254.169.254/x")).toBe(false);
    expect(isAllowedExternalUrl("https://api.stripe.com/v1")).toBe(true);
  });
});
