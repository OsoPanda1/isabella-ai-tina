import { createFileRoute } from "@tanstack/react-router";
import { generateImage, gateway } from "ai";
import { z } from "zod";
import { SecuritySystem } from "@/lib/security";
import { withSovereignAuth } from "@/lib/principal-context";
import { config } from "@/lib/config";
import { createHash } from "node:crypto";

const bodySchema = z.object({
  prompt: z.string().min(3).max(2000),
  style: z.enum(["realista", "arte", "territorial", "corporativo"]).default("territorial"),
  size: z.enum(["512x512", "1024x1024", "1792x1024"]).default("1024x1024"),
});

export const Route = createFileRoute("/api/v1/images/generate")({
  server: {
    handlers: {
      POST: withSovereignAuth("system", "execute", async (context, request) => {
        const rateLimit = SecuritySystem.checkRateLimit(context.ip, 20);
        if (!rateLimit.allowed) {
          const h = SecuritySystem.injectSecureHeaders(
            new Headers({ "content-type": "application/json" }),
          );
          return new Response(JSON.stringify({ error: "Límite imágenes 20/min" }), {
            status: 429,
            headers: h,
          });
        }
        let raw: unknown;
        try {
          raw = await request.json();
        } catch {
          raw = {};
        }
        const parsed = bodySchema.safeParse(raw);
        if (!parsed.success) {
          const h = SecuritySystem.injectSecureHeaders(
            new Headers({ "content-type": "application/json" }),
          );
          return new Response(
            JSON.stringify({ error: "Prompt inválido", details: parsed.error.issues }),
            { status: 400, headers: h },
          );
        }
        const { prompt, style, size } = parsed.data;
        const sanitized = SecuritySystem.sanitizePayload(prompt);
        if (sanitized.flagged) {
          const h = SecuritySystem.injectSecureHeaders(
            new Headers({ "content-type": "application/json" }),
          );
          return new Response(JSON.stringify({ error: `Filtro hostil: ${sanitized.reason}` }), {
            status: 403,
            headers: h,
          });
        }
        const model = "google/gemini-3.1-flash-image";
        const result = await generateImage({
          model: gateway.image(model),
          prompt: `${sanitized.clean}. Estilo ${style}. Composición territorial de Real del Monte, Hidalgo, México.`,
          size,
          n: 1,
        });
        const image = result.images[0];
        if (!image) throw new Error("image_provider_empty_result");
        const imageUrl = image.base64
          ? `data:${image.mediaType};base64,${image.base64}`
          : image.uint8Array
            ? `data:${image.mediaType};base64,${Buffer.from(image.uint8Array).toString("base64")}`
            : undefined;
        if (!imageUrl) throw new Error("image_provider_invalid_result");
        const imageId = `img_${createHash("sha256").update(`${prompt}:${context.traceId}`).digest("hex").slice(0, 12)}`;
        const h = SecuritySystem.injectSecureHeaders(
          new Headers({
            "content-type": "application/json",
            "x-isabella-trace-id": context.traceId,
          }),
        );
        return new Response(
          JSON.stringify({
            meta: {
              request_id: context.correlationId,
              trace_id: context.traceId,
              api_version: "v1",
              tenant_id: context.tenantId,
              timestamp: new Date().toISOString(),
            },
            data: {
              imageId,
              prompt: sanitized.clean,
              style,
              size,
              imageUrl,
              provider: model,
              provenance: {
                traceId: context.traceId,
                policyVersion: config().CROWN_CONSTITUTION_VERSION,
                evidenceStatus: "E1",
              },
            },
            error: null,
          }),
          { status: 200, headers: h },
        );
      }),
    },
  },
});
