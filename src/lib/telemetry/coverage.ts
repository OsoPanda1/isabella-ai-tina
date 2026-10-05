export const OBSERVABILITY_SURFACES = [
  "agent-runs",
  "sandboxes",
  "cron-jobs",
  "external-apis",
  "middleware",
  "runtime-cache",
] as const;

export type ObservabilitySurface = (typeof OBSERVABILITY_SURFACES)[number];

export function buildObservabilityCoverage(
  bySource: Array<{ source: string; count: number }>,
): Record<ObservabilitySurface, { observed: boolean; eventCount: number }> {
  const counts = new Map(bySource.map((entry) => [entry.source, entry.count]));
  return Object.fromEntries(
    OBSERVABILITY_SURFACES.map((surface) => [
      surface,
      { observed: (counts.get(surface) ?? 0) > 0, eventCount: counts.get(surface) ?? 0 },
    ]),
  ) as Record<ObservabilitySurface, { observed: boolean; eventCount: number }>;
}

export function hasCompleteObservabilityCoverage(
  coverage: Record<ObservabilitySurface, { observed: boolean; eventCount: number }>,
): boolean {
  return OBSERVABILITY_SURFACES.every((surface) => coverage[surface].observed);
}
