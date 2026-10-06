import { createFileRoute } from "@tanstack/react-router";
import { Route as ServerRoute } from "../../server-routes/api/igds";

// Autoridad única de routing: la lógica canónica vive en
// src/server-routes/api/igds.ts. Este archivo solo delega.
type Handlers = {
  GET: (ctx: unknown) => Promise<Response>;
  POST: (ctx: unknown) => Promise<Response>;
};
const server = ServerRoute.options.server;
if (!server) throw new Error("Ruta servidora sin handlers.");
const handlers = server.handlers as unknown as Handlers;

export const Route = createFileRoute("/api/igds")({
  server: {
    handlers: {
      GET: (context: IsabellaRouteContext) => handlers.GET(context),
      POST: (context: IsabellaRouteContext) => handlers.POST(context),
    },
  },
});
