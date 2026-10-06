import type { MoETelemetry, TelemetryLike } from "./contracts";

/** In-memory telemetry adapter. Callers may forward sanitized events to BookPI. */
export class InMemoryMoETelemetry implements TelemetryLike {
  private readonly events: MoETelemetry[] = [];

  record(event: MoETelemetry): void {
    this.events.push({ ...event, selectedExperts: [...event.selectedExperts] });
  }

  snapshot(): readonly MoETelemetry[] {
    return this.events.map((event) => ({ ...event, selectedExperts: [...event.selectedExperts] }));
  }
}

export function createMoETelemetryEvent(
  input: Omit<MoETelemetry, "latencyMs"> & { latencyMs: number },
): MoETelemetry {
  if (!Number.isFinite(input.latencyMs) || input.latencyMs < 0)
    throw new Error("moe_latency_invalid");
  return { ...input, selectedExperts: [...input.selectedExperts] };
}
