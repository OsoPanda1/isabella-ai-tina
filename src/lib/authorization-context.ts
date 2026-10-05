import { createHash, randomBytes } from "node:crypto";

export interface AuthorizationGeoContext {
  country?: string;
  region?: string;
  city?: string;
  source: "vercel-edge" | "cloudflare-edge" | "none";
}

export interface AuthorizationThreatIntel {
  riskScore: number;
  source: string;
  signals: string[];
}

export interface AuthorizationDynamicContext {
  geo_ip?: AuthorizationGeoContext;
  device_fingerprint?: string;
  behavior_score?: number;
  threat_intel?: AuthorizationThreatIntel;
  geo_mismatch?: boolean;
  device_changed?: boolean;
}

type BehaviorKey = string;
type BehaviorWindow = {
  timestamps: number[];
  lastDeviceFingerprint?: string;
  lastCountry?: string;
  denials: number;
};

const WINDOW_MS = 10 * 60_000;
const MAX_EVENTS = 120;
const behavior = new Map<BehaviorKey, BehaviorWindow>();

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, value));
}

function trimWindow(state: BehaviorWindow, now: number): void {
  state.timestamps = state.timestamps.filter((timestamp) => now - timestamp <= WINDOW_MS);
  if (state.timestamps.length > MAX_EVENTS) {
    state.timestamps = state.timestamps.slice(-MAX_EVENTS);
  }
}

function getState(tenantId: string, subjectId: string): BehaviorWindow {
  const key = `${tenantId}:${subjectId}`;
  const existing = behavior.get(key);
  if (existing) return existing;
  const created: BehaviorWindow = { timestamps: [], denials: 0 };
  behavior.set(key, created);
  return created;
}

function trustedGeo(request: Request): AuthorizationGeoContext | undefined {
  const vercelCountry = request.headers.get("x-vercel-ip-country")?.trim().toUpperCase();
  const cloudflareCountry = request.headers.get("cf-ipcountry")?.trim().toUpperCase();
  const country = vercelCountry || cloudflareCountry;
  if (!country || country.length !== 2) return undefined;

  const source = vercelCountry ? "vercel-edge" : cloudflareCountry ? "cloudflare-edge" : "none";

  const region =
    request.headers.get("x-vercel-ip-country-region")?.trim() ||
    request.headers.get("cf-ipregion")?.trim() ||
    undefined;
  const city =
    request.headers.get("x-vercel-ip-city")?.trim() ||
    request.headers.get("cf-ipcity")?.trim() ||
    undefined;

  return { country, region, city, source };
}

function deriveDeviceFingerprint(request: Request): string {
  const stableParts = [
    request.headers.get("user-agent") ?? "",
    request.headers.get("accept-language") ?? "",
    request.headers.get("sec-ch-ua") ?? "",
    request.headers.get("sec-ch-ua-platform") ?? "",
    request.headers.get("x-isabella-device-fingerprint") ?? "",
  ];
  return sha256(stableParts.join("\n"));
}

function deriveBehaviorScore(state: BehaviorWindow, now: number): number {
  trimWindow(state, now);
  const recent = state.timestamps.filter((timestamp) => now - timestamp <= 60_000).length;
  const burstScore = clamp(recent <= 4 ? 0 : ((recent - 4) / 20) * 70);
  const denialScore = clamp(Math.min(state.denials, 10) * 3);
  return Number(clamp(burstScore + denialScore).toFixed(2));
}

export function createUuidV7(): string {
  const timestamp = BigInt(Date.now());
  const bytes = randomBytes(10);
  const randA = ((BigInt(bytes[0]!) << 8n) | BigInt(bytes[1]!)) & 0xfffn;
  const randB =
    (BigInt(bytes[2]!) << 56n) |
    (BigInt(bytes[3]!) << 48n) |
    (BigInt(bytes[4]!) << 40n) |
    (BigInt(bytes[5]!) << 32n) |
    (BigInt(bytes[6]!) << 24n) |
    (BigInt(bytes[7]!) << 16n) |
    (BigInt(bytes[8]!) << 8n) |
    BigInt(bytes[9]!);

  const value =
    (timestamp << 80n) | (7n << 76n) | (randA << 64n) | (2n << 62n) | (randB & ((1n << 62n) - 1n));

  const hex = value.toString(16).padStart(32, "0");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Builds server-side dynamic authorization context.
 *
 * Geo data is accepted only from deployment-edge headers; no arbitrary client
 * IP geolocation or third-party feed is invented. Threat intelligence is
 * explicitly marked unavailable unless a trusted feed is integrated.
 */
export function buildAuthorizationDynamicContext(
  request: Request,
  tenantId: string,
  subjectId: string,
): AuthorizationDynamicContext {
  const now = Date.now();
  const state = getState(tenantId, subjectId);
  const geo = trustedGeo(request);
  const fingerprint = deriveDeviceFingerprint(request);

  trimWindow(state, now);
  state.timestamps.push(now);

  const deviceChanged =
    state.lastDeviceFingerprint !== undefined && state.lastDeviceFingerprint !== fingerprint;
  const currentCountry = geo?.country;
  const geoMismatch =
    state.lastCountry !== undefined &&
    currentCountry !== undefined &&
    state.lastCountry !== currentCountry;

  state.lastDeviceFingerprint = fingerprint;
  if (currentCountry) state.lastCountry = currentCountry;

  const behaviorScore = deriveBehaviorScore(state, now);

  return {
    ...(geo ? { geo_ip: geo } : {}),
    device_fingerprint: fingerprint,
    behavior_score: behaviorScore,
    threat_intel: {
      riskScore: 0,
      source: "none",
      signals: [],
    },
    geo_mismatch: geoMismatch,
    device_changed: deviceChanged,
  };
}

/** Records outcomes without storing request payloads or raw IPs. */
export function recordAuthorizationOutcome(
  tenantId: string,
  subjectId: string,
  allowed: boolean,
): void {
  const state = getState(tenantId, subjectId);
  if (!allowed) state.denials = Math.min(MAX_EVENTS, state.denials + 1);
}

export function resetAuthorizationBehaviorState(): void {
  behavior.clear();
}
