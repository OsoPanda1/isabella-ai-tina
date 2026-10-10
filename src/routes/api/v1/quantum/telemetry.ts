import { createFileRoute } from "@tanstack/react-router";
import { Route as ServerRoute } from "../../../../server-routes/api/v1/quantum/telemetry";

type Handlers = {
  GET: (ctx: unknown) => Promise<Response>;
};
const server = ServerRoute.options.server;
if (!server) throw new Error("Ruta quantum telemetry sin handlers.");
const handlers = server.handlers as unknown as Handlers;

export const Route = createFileRoute("/api/v1/quantum/telemetry")({
  server: {
    handlers: {
      GET: (context: IsabellaRouteContext) => handlers.GET(context),
    },
  },
});
