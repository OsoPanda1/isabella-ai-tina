import { createFileRoute } from "@tanstack/react-router";
import { ObservabilityService } from "../../lib/telemetry/observability";
import { getPersistedObservabilityOverview } from "../../lib/telemetry/observability-repository";
import {
  buildObservabilityCoverage,
  hasCompleteObservabilityCoverage,
} from "../../lib/telemetry/coverage";
import { withSovereignAuth } from "../../lib/principal-context";
import { SecuritySystem } from "../../lib/security";

export const Route = createFileRoute("/api/observability")({
  server: {
    handlers: {
      GET: withSovereignAuth("system", "read", async () => {
        const snapshot = ObservabilityService.getSnapshot();
        const persisted = await getPersistedObservabilityOverview();
        const coverage = buildObservabilityCoverage(persisted.bySource);
        const complete = hasCompleteObservabilityCoverage(coverage);
        return new Response(
          JSON.stringify({
            schema: "isabella.observability.v2",
            status: complete ? "ok" : "degraded",
            capabilities: {
              advertised: [
                "overview",
                "query",
                "notebooks",
                "alerts",
                "custom-metrics",
                "compute",
                "functions",
                "agent-runs",
                "sandboxes",
                "cron-jobs",
                "external-apis",
                "middleware",
                "runtime-cache",
              ],
              observed: coverage,
              complete,
            },
            snapshot,
            persisted,
          }),
          {
            status: complete ? 200 : 503,
            headers: SecuritySystem.injectSecureHeaders(
              new Headers({
                "content-type": "application/json; charset=utf-8",
                "cache-control": "no-store",
              }),
            ),
          },
        );
      }),
    },
  },
});
