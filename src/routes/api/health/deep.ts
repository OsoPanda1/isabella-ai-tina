import { createFileRoute } from "@tanstack/react-router";
import { Route as ServerRoute } from "../../../server-routes/api/health";

// Delega al handler canónico reescribiendo el path a /api/health/deep.
// Import estático para que el bundler (Nitro/Rolldown) resuelva en build.
type Handlers = {
  GET: (ctx: unknown) => Promise<Response>;
};
const server = ServerRoute.options.server;
if (!server) throw new Error("Ruta servidora sin handlers.");
const handlers = server.handlers as unknown as Handlers;

const loadHandler = (context: unknown): Promise<Response> => {
  const request = (context as { request: Request }).request;
  const url = new URL(request.url);
  url.pathname = "/api/health/deep";
  return handlers.GET({ request: new Request(url, request) });
};

export const Route = createFileRoute("/api/health/deep")({
  server: { handlers: { GET: (context: IsabellaRouteContext) => loadHandler(context) } },
});
