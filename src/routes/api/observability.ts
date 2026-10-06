import { createFileRoute } from "@tanstack/react-router";
import { Route as ServerRoute } from "../../server-routes/api/observability";

type Handlers = { GET: (ctx: unknown) => Promise<Response> };
const server = ServerRoute.options.server;
if (!server) throw new Error("Ruta observability sin handlers.");
const handlers = server.handlers as unknown as Handlers;

export const Route = createFileRoute("/api/observability")({
  server: { handlers: { GET: (context: IsabellaRouteContext) => handlers.GET(context) } },
});
