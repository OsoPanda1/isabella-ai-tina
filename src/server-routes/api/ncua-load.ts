import { createHash, randomUUID } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { withSovereignAuth } from "@/lib/principal-context";
import { config } from "@/lib/config";
import { NCUAAcademicPipeline } from "@/lib/ncua/academic-pipeline";
import { ERI_MIN_SCORE } from "@/lib/ncua/eri";
import { ObservabilityService } from "@/lib/telemetry/observability";
import { recordObservabilityEvent } from "@/lib/telemetry/observability-repository";
import { SecuritySystem } from "@/lib/security";

const requestSchema = z.object({
  count: z.number().int().min(1).max(500).default(50),
  label: z.string().min(1).max(64).default("live"),
});

const BASE_TEXT =
  "Ejecutar análisis NCUA de soberanía territorial y validar ERI, QUP y BookPI con evidencia reproducible.";

function makeInput(index: number, label: string) {
  return `${BASE_TEXT} ${label} ejecución concurrente #${index}.`;
}

export const Route = createFileRoute("/api/ncua-load")({
  server: {
    handlers: {
      POST: withSovereignAuth("system", "write", async (_context, request) => {
        const started = performance.now();
        const headers = SecuritySystem.injectSecureHeaders(
          new Headers({
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
          }),
        );

        const body = await request.json().catch(() => ({}));
        const parsed = requestSchema.safeParse(body);
        if (!parsed.success) {
          return new Response(JSON.stringify({ error: "Invalid NCUA load request." }), {
            status: 400,
            headers,
          });
        }

        const secret = config().AEGIS_AUDIT_SECRET;
        if (!secret) {
          return new Response(
            JSON.stringify({ error: "NCUA evidence signing secret unavailable." }),
            { status: 503, headers },
          );
        }

        const pipeline = new NCUAAcademicPipeline({
          hmacKey: secret,
          entropyThresholds: [1.8],
          maxRefinements: 1,
        });

        const results = await Promise.all(
          Array.from({ length: parsed.data.count }, (_, index) =>
            pipeline.execute(
              makeInput(index, parsed.data.label),
              `live-${parsed.data.label}-${index}`,
            ),
          ),
        );

        const elapsedMs = performance.now() - started;
        const eriValues = results.map((result) => result.epistemicRobustnessIndex);
        const totalBytes = results.reduce((sum, result) => sum + result.rawInputLengthBytes, 0);
        const successes = results.filter((result) => result.status === "SUCCESS").length;
        const failed = results.length - successes;
        const sortedLatency = [...results]
          .map(() => elapsedMs / Math.max(1, results.length))
          .sort((a, b) => a - b);
        const percentile = (p: number) =>
          sortedLatency[
            Math.min(sortedLatency.length - 1, Math.ceil(sortedLatency.length * p) - 1)
          ] ?? 0;

        const evidence = {
          schema: "isabella.ncua.live-load.v1",
          evidenceId: randomUUID(),
          observedAt: new Date().toISOString(),
          label: parsed.data.label,
          concurrency: parsed.data.count,
          elapsedMs: Number(elapsedMs.toFixed(3)),
          throughputMbPerSec: Number((totalBytes / Math.max(1, elapsedMs) / 1000).toFixed(3)),
          successCount: successes,
          failureCount: failed,
          eriMin: Math.min(...eriValues),
          eriMax: Math.max(...eriValues),
          eriThreshold: ERI_MIN_SCORE,
          p50ApproxMs: Number(percentile(0.5).toFixed(3)),
          p95ApproxMs: Number(percentile(0.95).toFixed(3)),
          p99ApproxMs: Number(percentile(0.99).toFixed(3)),
          evidenceHash: "",
        };
        evidence.evidenceHash = createHash("sha256")
          .update(JSON.stringify({ ...evidence, evidenceHash: undefined }))
          .digest("hex");

        ObservabilityService.recordEvent(elapsedMs, failed > 0 ? 1 : 0);
        await recordObservabilityEvent({
          traceId: evidence.evidenceId,
          eventType: "ncua.live_load",
          source: "ncua-load",
          durationMs: elapsedMs,
          severity: failed > 0 ? "error" : "info",
          payload: evidence,
        });

        return new Response(
          JSON.stringify({
            ...evidence,
            status: failed === 0 && evidence.eriMin >= ERI_MIN_SCORE ? "PASS" : "FAIL",
          }),
          { headers },
        );
      }),
    },
  },
});
