import { createFileRoute } from "@tanstack/react-router";
import { Route as ServerRoute } from "../../server-routes/api/security";

// Canonical handler lives in server-routes/api/security.ts. This route remains a thin typed boundary. Keep the public
// route as a typed delegation boundary so future edits cannot silently widen
// the endpoint to an untyped/unauthenticated handler.
type ServerRequestContext = { request: Request };
type ServerHandlers = {
  POST: (context: ServerRequestContext) => Promise<Response>;
};

const server = ServerRoute.options.server;
if (!server?.handlers) throw new Error("Ruta servidora sin handlers.");
const handlers = server.handlers as unknown as ServerHandlers;

export const Route = createFileRoute("/api/security")({
  server: {
    handlers: {
      POST: ({ request }: IsabellaRouteContext) => handlers.POST({ request }),
    },
  },
});
