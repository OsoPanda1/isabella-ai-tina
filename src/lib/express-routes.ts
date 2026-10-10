import { Router } from "express";
import { authenticate, requireRole, requireScope, currentPrincipal } from "./auth.server";
import { metrics, readAudit } from "./atlas-kernel.server";
import { evaluatePolicy, anubisStats } from "./anubis.server";
import { readLedger, ledgerStats } from "./bookpi.server";
import {
  isabellaStats,
  getRecommendations,
  moderateContent,
  updateEmotionalState,
  searchEpisodes,
} from "./isabella.server";
import { getGraph, getEvents } from "./eoct.server";
import {
  listProducts,
  listOrders,
  economyStats,
  createOrder,
  payOrder,
  mintCredits,
} from "./economy.server";
import { listNamespaces, listProposals, daoStats, castVote, createProposal } from "./dao.server";
import { EventSchemas } from "./events-catalog";
import { publish } from "./eventbus.server";
import {
  createDocument,
  transitionState,
  listDocuments,
  registryStats,
} from "./document-registry.server";
import { getQuantumReflection } from "./quantum-bridge.server";

export const atlasRouter = Router();

atlasRouter.get("/api/atlas/getCockpitSnapshot", async (_req, res) => {
  res.json({
    now: new Date().toISOString(),
    metrics: metrics.snapshot(),
    auditLogs: readAudit(10),
    bookpi: { stats: ledgerStats() },
    anubis: { stats: anubisStats() },
    isabella: { stats: isabellaStats() },
    eoct: { events: getEvents(10) },
    economy: { stats: economyStats() },
    dao: { stats: daoStats() },
  });
});

atlasRouter.get("/api/atlas/getFederationGraph", async (_req, res) => {
  res.json(getGraph(200));
});

atlasRouter.post(
  "/api/atlas/emitEoctEvent",
  authenticate,
  requireScope("events:write"),
  async (req, res) => {
    try {
      const data = EventSchemas[req.body.type as keyof typeof EventSchemas]?.parse(req.body);
      if (!data) throw new Error("Invalid event type");
      await publish(
        data as unknown as import("./eventbus.server").PublishInput<
          import("./events-catalog").AtlasEventType
        >,
      );
      res.json({ success: true, event_id: req.body.event_id });
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  },
);

atlasRouter.post("/api/atlas/getLedger", authenticate, requireScope("ledger:read"), (_req, res) => {
  res.json(readLedger(50));
});

atlasRouter.post(
  "/api/atlas/evalAnubisPolicy",
  authenticate,
  requireScope("policy:evaluate"),
  (req, res) => {
    res.json(evaluatePolicy(req.body));
  },
);

atlasRouter.post(
  "/api/atlas/isabellaAsk",
  authenticate,
  requireScope("memory:read"),
  async (req, res) => {
    try {
      res.json(searchEpisodes(req.body.query, 3));
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  },
);

atlasRouter.post(
  "/api/atlas/isabellaRecommend",
  authenticate,
  requireScope("memory:read"),
  async (req, res) => {
    try {
      res.json(getRecommendations(currentPrincipal(req).sub, req.body.context));
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  },
);

atlasRouter.post(
  "/api/atlas/isabellaModerate",
  authenticate,
  requireScope("policy:evaluate"),
  async (req, res) => {
    try {
      res.json(moderateContent(req.body.content, req.body.context));
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  },
);

atlasRouter.post("/api/atlas/setEmotional", authenticate, requireRole("operator"), (req, res) => {
  res.json(updateEmotionalState(req.body));
});

atlasRouter.get("/api/atlas/getEconomySnapshot", (_req, res) => {
  res.json({ products: listProducts(), orders: listOrders(), stats: economyStats() });
});

atlasRouter.post(
  "/api/atlas/purchaseProduct",
  authenticate,
  requireScope("economy:purchase"),
  async (req, res) => {
    try {
      const order = createOrder(currentPrincipal(req).sub, req.body.productId);
      payOrder(order.id);
      res.json(order);
    } catch (e: unknown) {
      res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
    }
  },
);

atlasRouter.post("/api/atlas/mintUserCredits", authenticate, requireRole("admin"), (req, res) => {
  res.json(mintCredits(currentPrincipal(req).sub, req.body.amount));
});

atlasRouter.get("/api/atlas/getDaoSnapshot", (_req, res) => {
  res.json({ namespaces: listNamespaces(), proposals: listProposals(), stats: daoStats() });
});

atlasRouter.post("/api/atlas/daoVote", authenticate, requireScope("dao:vote"), (req, res) => {
  res.json(castVote(req.body.proposalId, currentPrincipal(req).sub, req.body.choice));
});

atlasRouter.post(
  "/api/atlas/daoCreateProposal",
  authenticate,
  requireScope("dao:write"),
  (req, res) => {
    res.json(
      createProposal(
        currentPrincipal(req).sub,
        req.body.namespaceId,
        req.body.title,
        req.body.body,
      ),
    );
  },
);

// Registry
atlasRouter.post(
  "/api/registry/rpcCreateDocument",
  authenticate,
  requireScope("registry:write"),
  async (req, res) => {
    try {
      res.json(await createDocument(req.body));
    } catch (e: unknown) {
      res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
    }
  },
);

atlasRouter.post(
  "/api/registry/rpcTransitionState",
  authenticate,
  requireRole("operator"),
  async (req, res) => {
    try {
      res.json(await transitionState(req.body));
    } catch (e: unknown) {
      res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
    }
  },
);

atlasRouter.get("/api/registry/rpcRegistrySnapshot", (_req, res) => {
  res.json({ documents: listDocuments(), stats: registryStats() });
});

// Telemetry
atlasRouter.get("/api/telemetry/getTelemetrySnapshot", (_req, res) => {
  res.json({ metrics: metrics.snapshot() });
});

atlasRouter.post(
  "/api/telemetry/fireSyntheticEvent",
  authenticate,
  requireRole("operator"),
  (req, res) => {
    metrics.counter("synthetic_events_total").inc({ origin: req.body.origin || "api" });
    res.json({ success: true });
  },
);

atlasRouter.get("/api/atlas/quantumReflection", (_req, res) => {
  res.json(getQuantumReflection());
});
