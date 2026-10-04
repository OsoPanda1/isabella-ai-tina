import { createFileRoute } from "@tanstack/react-router";
import { Route as ServerRoute } from "../../server-routes/api/video-engine-x";

type ServerRequestContext = { request: Request };
type ServerHandlers = {
  GET: (context: ServerRequestContext) => Promise<Response>;
  POST: (context: ServerRequestContext) => Promise<Response>;
};

const server = ServerRoute.options.server;
if (!server?.handlers) throw new Error("Ruta servidora sin handlers.");
const handlers = server.handlers as unknown as ServerHandlers;

export const Route = createFileRoute("/api/video-engine-x")({
  server: {
    handlers: {
      GET: ({ request }: IsabellaRouteContext) => handlers.GET({ request }),
      POST: ({ request }: IsabellaRouteContext) => handlers.POST({ request }),
    },
  },
});
