import { createFileRoute } from "@tanstack/react-router";
import { withSovereignAuth } from "@/lib/principal-context";
import { handleIsabellaChat } from "@/lib/isabella-chat-gateway";

export const Route = createFileRoute("/api/isabella")({
  server: {
    handlers: {
      POST: withSovereignAuth("chat", "execute", async (context, request) =>
        handleIsabellaChat(
          {
            ip: context.ip,
            traceId: context.traceId,
            correlationId: context.correlationId,
            userId: context.userId,
            tenantId: context.tenantId,
            role: context.role,
            scope: context.scope,
          },
          request,
        ),
      ),
    },
  },
});
