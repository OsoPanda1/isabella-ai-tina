/**
 * AI Transparency Route (src/server-routes/api/ai-transparency.ts)
 */
import { createFileRoute } from "@tanstack/react-router";
import { getAIGovernanceProfile } from "../../lib/ai-governance";

export const Route = createFileRoute("/api/ai/transparency")({
  server: {
    handlers: {
      GET: async () =>
        new Response(JSON.stringify(getAIGovernanceProfile()), {
          headers: { "Content-Type": "application/json; charset=utf-8" },
        }),
    },
  },
});

export { getAIGovernanceProfile };
