import { createFileRoute } from "@tanstack/react-router";
import { start, status } from "@/server-routes/api/connect";

export const Route = createFileRoute("/api/connect/slack")({
  server: {
    handlers: {
      GET: ({ request }: IsabellaRouteContext) =>
        start({
          request: new Request(
            `${request.url}${request.url.includes("?") ? "&" : "?"}provider=slack`,
            request,
          ),
        }),
      POST: ({ request }: IsabellaRouteContext) =>
        status({
          request: new Request(
            `${request.url}${request.url.includes("?") ? "&" : "?"}provider=slack`,
            request,
          ),
        }),
    },
  },
});
