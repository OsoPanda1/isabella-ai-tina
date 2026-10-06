import { createFileRoute } from "@tanstack/react-router";
import { Route as ServerRoute } from "../../../server-routes/api/v1/api-keys";

type Handlers = {
  GET: (ctx: unknown) => Promise<Response>;
  POST: (ctx: unknown) => Promise<Response>;
  DELETE: (ctx: unknown) => Promise<Response>;
};

const server = ServerRoute.options.server;
if (!server) throw new Error("Ruta API keys sin handlers.");
const handlers = server.handlers as unknown as Handlers;

export const Route = createFileRoute("/api/v1/api-keys")({
  server: {
    handlers: {
      GET: (context: IsabellaRouteContext) => handlers.GET(context),
      POST: (context: IsabellaRouteContext) => handlers.POST(context),
      DELETE: (context: IsabellaRouteContext) => handlers.DELETE(context),
    },
  },
});
