import { prisma } from "../db";

export interface PersistedObservabilityOverview {
  eventCount: number;
  errorCount: number;
  avgLatencyMs: number;
  throughputPerMinute: number;
  latestEventAt: string | null;
  bySource: Array<{ source: string; count: number }>;
}

export async function recordObservabilityEvent(event: {
  traceId: string;
  eventType: string;
  source: string;
  durationMs?: number;
  severity?: string;
  payload?: Record<string, unknown>;
}) {
  await prisma.$executeRaw`
    INSERT INTO public.observability_events
      (trace_id, event_type, source, duration_ms, severity, payload)
    VALUES
      (${event.traceId}, ${event.eventType}, ${event.source}, ${event.durationMs ?? 0}, ${event.severity ?? "info"}, ${JSON.stringify(event.payload ?? {})}::jsonb)
  `;
}

export async function getPersistedObservabilityOverview(): Promise<PersistedObservabilityOverview> {
  const [summary, sources] = await Promise.all([
    prisma.$queryRaw<
      Array<{
        event_count: bigint;
        error_count: bigint;
        avg_latency_ms: number | null;
        latest_event_at: Date | null;
      }>
    >`
      SELECT
        COUNT(*)::bigint AS event_count,
        COUNT(*) FILTER (WHERE severity IN ('error', 'critical'))::bigint AS error_count,
        COALESCE(AVG(duration_ms), 0)::float AS avg_latency_ms,
        MAX(created_at) AS latest_event_at
      FROM public.observability_events
      WHERE created_at >= now() - interval '24 hours'
    `,
    prisma.$queryRaw<Array<{ source: string; count: bigint }>>`
      SELECT source, COUNT(*)::bigint AS count
      FROM public.observability_events
      WHERE created_at >= now() - interval '24 hours'
      GROUP BY source
      ORDER BY count DESC
      LIMIT 20
    `,
  ]);

  const result = summary[0];
  return {
    eventCount: Number(result?.event_count ?? 0),
    errorCount: Number(result?.error_count ?? 0),
    avgLatencyMs: Number(result?.avg_latency_ms ?? 0),
    throughputPerMinute: Number(result?.event_count ?? 0) / (24 * 60),
    latestEventAt: result?.latest_event_at?.toISOString() ?? null,
    bySource: sources.map((source: { source: string; count: bigint }) => ({
      source: source.source,
      count: Number(source.count),
    })),
  };
}
