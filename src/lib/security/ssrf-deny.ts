/**
 * DENEGACION SSRF INDEPENDIENTE DE LA ALLOWLIST (src/lib/security/ssrf-deny.ts)
 * -----------------------------------------------------------------
 * Lista de denegacion que se evalua ANTES y de forma independiente de
 * cualquier allowlist: un host derivado de configuracion (VOICE_API_URL,
 * ANTHROPIC_BASE_URL, region Bedrock) o estaticamente permitido nunca debe
 * alcanzarse si cae en un rango bloqueado — IMDS 169.254.169.254 incluida —
 * o si termina en un sufijo interno. Espejo local del contrato de iron-proxy
 * "cloud metadata IPs are refused by default regardless of allowlist",
 * sin binario, sin TLS interception: solo evaluacion de host server-side.
 */

/** CIDRs IPv4/IPv6 denegados por defecto para egress server-side. */
export const SSRF_DENIED_CIDRS: readonly string[] = [
  "0.0.0.0/8",
  "127.0.0.0/8",
  "10.0.0.0/8",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "169.254.0.0/16",
  "100.64.0.0/10",
  "198.18.0.0/15",
  "::/128",
  "::1/128",
  "fe80::/10",
  "fc00::/7",
  "::ffff:0:0/96",
];

/** Hostnames exactos denegados (formas de loopback). */
export const SSRF_DENIED_HOSTNAMES: readonly string[] = ["localhost"];

/** Sufijos de host denegados (intranet, mDNS, dominios internos). */
export const SSRF_DENIED_HOST_SUFFIXES: readonly string[] = [".internal", ".local", ".localhost"];

interface DenyCidr {
  readonly family: 4 | 6;
  readonly bytes: Uint8Array;
  readonly prefixLength: number;
}

function parseIpv4(value: string): Uint8Array | null {
  const octets = value.split(".");
  if (octets.length !== 4) return null;
  const bytes = new Uint8Array(4);
  for (let i = 0; i < 4; i += 1) {
    const octet = octets[i];
    if (!/^\d{1,3}$/.test(octet)) return null;
    const numeric = Number(octet);
    if (!Number.isInteger(numeric) || numeric < 0 || numeric > 255) return null;
    bytes[i] = numeric;
  }
  return bytes;
}

function parseIpv4Tail(value: string): { hi: number; lo: number } | null {
  const octets = parseIpv4(value);
  if (!octets) return null;
  const hi = ((octets[0] << 8) | octets[1]) >>> 0;
  const lo = ((octets[2] << 8) | octets[3]) >>> 0;
  return { hi, lo };
}

function parseHextetGroup(text: string): number[] | null {
  const groups = text === "" ? [] : text.split(":");
  const values: number[] = [];
  for (const piece of groups) {
    if (!/^[0-9a-f]{1,4}$/i.test(piece)) return null;
    values.push(parseInt(piece, 16));
  }
  return values;
}

function parseIpv6(value: string): Uint8Array | null {
  if (!value.includes(":")) return null;
  let text = value.trim().toLowerCase();
  const zone = text.indexOf("%");
  if (zone >= 0) text = text.slice(0, zone);
  if (text.startsWith("[") && text.endsWith("]")) text = text.slice(1, -1);
  const lastColon = text.lastIndexOf(":");
  const lastPiece = text.slice(lastColon + 1);
  if (lastPiece.includes(".")) {
    const tail = parseIpv4Tail(lastPiece);
    if (!tail) return null;
    text = `${text.slice(0, lastColon + 1)}${tail.hi.toString(16)}:${tail.lo.toString(16)}`;
  }
  const doubleColon = text.indexOf("::");
  let raw: number[];
  if (doubleColon >= 0) {
    if (doubleColon !== text.lastIndexOf("::")) return null;
    const left = parseHextetGroup(text.slice(0, doubleColon));
    const right = parseHextetGroup(text.slice(doubleColon + 2));
    if (!left || !right) return null;
    const missing = 8 - (left.length + right.length);
    if (missing < 1) return null;
    raw = [...left, ...new Array<number>(missing).fill(0), ...right];
  } else {
    const groups = parseHextetGroup(text);
    if (!groups || groups.length !== 8) return null;
    raw = groups;
  }
  if (raw.length !== 8) return null;
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 8; i += 1) {
    const value16 = raw[i] & 0xffff;
    bytes[i * 2] = (value16 >> 8) & 0xff;
    bytes[i * 2 + 1] = value16 & 0xff;
  }
  return bytes;
}

function normalizeAddress(value: string): string {
  let text = value.trim().toLowerCase();
  if (text.startsWith("[") && text.endsWith("]")) text = text.slice(1, -1);
  const zone = text.indexOf("%");
  if (zone >= 0) text = text.slice(0, zone);
  while (text.endsWith(".")) text = text.slice(0, -1);
  return text;
}

function parseCidrNotation(cidr: string): DenyCidr {
  const separator = cidr.lastIndexOf("/");
  if (separator < 1) {
    throw new Error(`SSRF deny CIDR invalido (sin prefijo): ${cidr}`);
  }
  const address = normalizeAddress(cidr.slice(0, separator));
  const prefixLength = Number(cidr.slice(separator + 1));
  const family: 4 | 6 = address.includes(":") ? 6 : 4;
  const maxPrefix = family === 4 ? 32 : 128;
  if (!Number.isInteger(prefixLength) || prefixLength < 0 || prefixLength > maxPrefix) {
    throw new Error(`SSRF deny CIDR invalido (prefijo fuera de rango): ${cidr}`);
  }
  const bytes = family === 4 ? parseIpv4(address) : parseIpv6(address);
  if (!bytes) {
    throw new Error(`SSRF deny CIDR invalido (direccion): ${cidr}`);
  }
  return { family, bytes, prefixLength };
}

/** Parseo en carga de modulo: un CIDR mal declarado es error de programacion, no de runtime. */
const DENIED_CIDRS: readonly DenyCidr[] = SSRF_DENIED_CIDRS.map(parseCidrNotation);

function inCidr(bytes: Uint8Array, cidr: DenyCidr): boolean {
  const fullBytes = Math.floor(cidr.prefixLength / 8);
  const remainderBits = cidr.prefixLength % 8;
  for (let i = 0; i < fullBytes; i += 1) {
    if (bytes[i] !== cidr.bytes[i]) return false;
  }
  if (remainderBits === 0) return true;
  const mask = (0xff << (8 - remainderBits)) & 0xff;
  return (bytes[fullBytes] & mask) === (cidr.bytes[fullBytes] & mask);
}

/**
 * true si el hostname esta denegado por SSRF: loopback, RFC1918, CGNAT,
 * link-local/ULA, IMDS, v4-mapped o sufijo interno. Evaluar ANTES de la
 * allowlist; nunca combine con un `||` que permita saltar la denegacion.
 */
export function isSsrfDeniedHost(hostname: string): boolean {
  const host = normalizeAddress(hostname);
  if (host === "") return false;
  if (SSRF_DENIED_HOSTNAMES.includes(host)) return true;
  if (SSRF_DENIED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true;
  const ipv4 = parseIpv4(host);
  if (ipv4) return DENIED_CIDRS.some((cidr) => cidr.family === 4 && inCidr(ipv4, cidr));
  const ipv6 = parseIpv6(host);
  if (ipv6) return DENIED_CIDRS.some((cidr) => cidr.family === 6 && inCidr(ipv6, cidr));
  return false;
}

/**
 * true si la URL apunta a un host denegado. Una URL que no puede parsearse
 * se considera denegada (fail-closed).
 */
export function isSsrfDeniedUrl(url: string): boolean {
  try {
    return isSsrfDeniedHost(new URL(url).hostname);
  } catch {
    return true;
  }
}
