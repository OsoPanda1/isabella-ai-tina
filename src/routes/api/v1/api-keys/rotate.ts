import { createFileRoute } from "@tanstack/react-router";
import { Route as ServerRoute } from "../../../../server-routes/api/v1/api-keys/rotate";

type Handlers = { POST: (ctx: unknown) => Promise<Response> };
const server = ServerRoute.options.server;
if (!server) throw new Error("Ruta API key rotation sin handlers.");
const handlers = server.handlers as unknown as Handlers;

export const Route = createFileRoute("/api/v1/api-keys/rotate")({
  server: {
    handlers: {
      POST: (context: IsabellaRouteContext) => handlers.POST(context),
    },
  },
});
