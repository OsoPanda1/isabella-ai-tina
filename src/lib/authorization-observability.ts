export interface AuthorizationObservation {
  decisionId: string;
  tenantId: string;
  subjectId: string;
  action: string;
  resource: string;
  allow: boolean;
  anomalyScore: number;
  cacheHit: boolean;
  latencyMs: number;
  policyLatencyMs: number;
  cacheLatencyMs: number;
  geoMismatch: boolean;
  deviceChanged: boolean;
  timestamp: string;
}

const MAX_POINTS = 2_000;
const observations: AuthorizationObservation[] = [];

export function recordAuthorizationObservation(
  observation: AuthorizationObservation,
): void {
  observations.push({ ...observation });
  if (observations.length > MAX_POINTS) observations.splice(0, observations.length - MAX_POINTS);
}

export function getAuthorizationObservations(): AuthorizationObservation[] {
  return observations.map((item) => ({ ...item }));
}

export function getAuthorizationMetrics(): {
  total: number;
  allows: number;
  denies: number;
  cacheHitRate: number;
  anomalyAlerts: number;
  geoMismatchCount: number;
  deviceChangeCount: number;
  p95LatencyMs: number;
} {
  if (observations.length === 0) {
    return {
      total: 0,
      allows: 0,
      denies: 0,
      cacheHitRate: 0,
      anomalyAlerts: 0,
      geoMismatchCount: 0,
      deviceChangeCount: 0,
      p95LatencyMs: 0,
    };
  }
  const latencies = observations.map((item) => item.latencyMs).sort((a, b) => a - b);
  const p95Index = Math.min(latencies.length - 1, Math.ceil(latencies.length * 0.95) - 1);
  const cacheHits = observations.filter((item) => item.cacheHit).length;
  return {
    total: observations.length,
    allows: observations.filter((item) => item.allow).length,
    denies: observations.filter((item) => !item.allow).length,
    cacheHitRate: cacheHits / observations.length,
    anomalyAlerts: observations.filter((item) => item.anomalyScore > 70).length,
    geoMismatchCount: observations.filter((item) => item.geoMismatch).length,
    deviceChangeCount: observations.filter((item) => item.deviceChanged).length,
    p95LatencyMs: latencies[p95Index] ?? 0,
  };
}

export function clearAuthorizationObservations(): void {
  observations.length = 0;
}
