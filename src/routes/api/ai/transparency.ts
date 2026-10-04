import { createFileRoute } from "@tanstack/react-router";
import { Route as ServerRoute } from "../../../server-routes/api/ai-transparency";

type Handlers = {
  GET: (ctx: unknown) => Promise<Response>;
};

const server = ServerRoute.options.server;
if (!server) throw new Error("Ruta servidora sin handlers.");
const handlers = server.handlers as unknown as Handlers;

export const Route = createFileRoute("/api/ai/transparency")({
  server: { handlers: { GET: (context) => handlers.GET(context) } },
});
