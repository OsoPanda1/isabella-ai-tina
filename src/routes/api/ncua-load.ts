import { createFileRoute } from "@tanstack/react-router";
import { Route as ServerRoute } from "../../server-routes/api/ncua-load";

type Handlers = { POST: (ctx: unknown) => Promise<Response> };
const server = ServerRoute.options.server;
if (!server) throw new Error("Ruta ncua-load sin handlers.");
const handlers = server.handlers as unknown as Handlers;

export const Route = createFileRoute("/api/ncua-load")({
  server: { handlers: { POST: (context: IsabellaRouteContext) => handlers.POST(context) } },
});
