import { createFileRoute } from "@tanstack/react-router";
import { Route as ServerRoute } from "../../server-routes/api/isabella-voice";

// Autoridad única de routing: la lógica canónica vive en
// src/server-routes/api/isabella-voice.ts. Este archivo solo delega
// (ver ADR-001-source-of-truth). Import estático para que el
// bundler (Nitro/Rolldown) resuelva el módulo en build.
type Handlers = {
  POST: (ctx: unknown) => Promise<Response>;
};
const server = ServerRoute.options.server;
if (!server) throw new Error("Ruta servidora sin handlers.");
const handlers = server.handlers as unknown as Handlers;

export const Route = createFileRoute("/api/isabella-voice")({
  server: { handlers: { POST: (context: IsabellaRouteContext) => handlers.POST(context) } },
});
