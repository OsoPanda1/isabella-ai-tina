import { createFileRoute } from "@tanstack/react-router";
import { start, status } from "@/server-routes/api/connect";

export const Route = createFileRoute("/api/connect/github")({
  server: {
    handlers: {
      GET: ({ request }: IsabellaRouteContext) =>
        start({
          request: new Request(
            `${request.url}${request.url.includes("?") ? "&" : "?"}provider=github`,
            request,
          ),
        }),
      POST: ({ request }: IsabellaRouteContext) =>
        status({
          request: new Request(
            `${request.url}${request.url.includes("?") ? "&" : "?"}provider=github`,
            request,
          ),
        }),
    },
  },
});
