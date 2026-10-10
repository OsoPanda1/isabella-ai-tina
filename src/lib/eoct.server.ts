/**
 * EOCT — Event & Ontology Core Trace
 * State machine events, ontology nodes/edges, civilizational graph.
 * Federation: F-01 Knowledge
 */
import { createHash } from "node:crypto";
import { appendBlock } from "./bookpi.server";

// ── Ontology ──────────────────────────────────────────────────────────────────
export type OntologyNodeType =
  "entity" | "concept" | "relation" | "event" | "territory" | "actor" | "module" | "federation";

export interface OntologyNode {
  id: string;
  type: OntologyNodeType;
  label: string;
  description?: string;
  federation?: string;
  attrs: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface OntologyEdge {
  id: string;
  from: string;
  to: string;
  rel: string; // typed relation
  weight: number;
  createdAt: string;
}

// ── State Machine Events ──────────────────────────────────────────────────────
export interface EOCTEvent {
  id: string;
  ts: string;
  type: string;
  source: string;
  target?: string;
  payload: Record<string, unknown>;
  prevState?: string;
  nextState?: string;
  traceId: string;
}

const nodes = new Map<string, OntologyNode>();
const edges: OntologyEdge[] = [];
const events: EOCTEvent[] = [];
const EVENT_MAX = 2_000;

function uid(seed: string): string {
  return createHash("sha256")
    .update(seed + Date.now() + Math.random())
    .digest("hex")
    .slice(0, 16);
}

export function upsertNode(
  node: Omit<OntologyNode, "id" | "createdAt" | "updatedAt"> & { id?: string },
): OntologyNode {
  const now = new Date().toISOString();
  const id = node.id ?? uid(node.label);
  const existing = nodes.get(id);
  const n: OntologyNode = { ...node, id, createdAt: existing?.createdAt ?? now, updatedAt: now };
  nodes.set(id, n);
  return n;
}

export function addEdge(from: string, to: string, rel: string, weight = 1.0): OntologyEdge {
  const e: OntologyEdge = {
    id: uid(`${from}${to}${rel}`),
    from,
    to,
    rel,
    weight,
    createdAt: new Date().toISOString(),
  };
  edges.push(e);
  return e;
}

export function emitEvent(input: {
  type: string;
  source: string;
  target?: string;
  payload?: Record<string, unknown>;
  prevState?: string;
  nextState?: string;
  traceId?: string;
}): EOCTEvent {
  const evt: EOCTEvent = {
    id: uid(input.type + input.source),
    ts: new Date().toISOString(),
    type: input.type,
    source: input.source,
    target: input.target,
    payload: input.payload ?? {},
    prevState: input.prevState,
    nextState: input.nextState,
    traceId: input.traceId ?? uid("trace"),
  };
  events.push(evt);
  if (events.length > EVENT_MAX) events.splice(0, events.length - EVENT_MAX);
  appendBlock({
    eventType: "eoct_event",
    module: "EOCT",
    action: evt.type,
    actor: evt.source,
    data: { eventId: evt.id, target: evt.target },
  });
  return evt;
}

export function getGraph(limit = 200): { nodes: OntologyNode[]; edges: OntologyEdge[] } {
  return { nodes: Array.from(nodes.values()).slice(-limit), edges: edges.slice(-limit * 2) };
}

export function getEvents(limit = 100): EOCTEvent[] {
  return events.slice(-limit).reverse();
}

// ── Seed canonical ontology from TAMV spec ────────────────────────────────────
const FEDERATIONS = [
  { id: "F01", label: "Conocimiento", federation: "F01" },
  { id: "F02", label: "Identidad", federation: "F02" },
  { id: "F03", label: "Gobernanza", federation: "F03" },
  { id: "F04", label: "Economía", federation: "F04" },
  { id: "F05", label: "Seguridad", federation: "F05" },
  { id: "F06", label: "Infraestructura", federation: "F06" },
  { id: "F07", label: "IA Cognitiva", federation: "F07" },
];
const MODULES = [
  { id: "ATLAS-KERNEL", label: "Atlas Kernel", federation: "F01" },
  { id: "EOCT", label: "EOCT", federation: "F01" },
  { id: "BOOKPI", label: "BookPI", federation: "F01" },
  { id: "GEMET", label: "GEMET", federation: "F01" },
  { id: "ANUBIS", label: "Anubis Sentinel", federation: "F05" },
  { id: "HORUS", label: "Horus Radar", federation: "F05" },
  { id: "ISABELLA", label: "Isabella AI", federation: "F07" },
  { id: "KORIMA", label: "KORIMA Codex", federation: "F03" },
  { id: "SDMD7", label: "SDMD-7", federation: "F03" },
  { id: "LUCRUM", label: "Lucrum Prime", federation: "F04" },
  { id: "OMNIGATEWAY", label: "OmniKernelGatewayX6", federation: "F06" },
  { id: "SPIRE", label: "SPIFFE/SPIRE", federation: "F02" },
];

for (const f of FEDERATIONS)
  upsertNode({ id: f.id, type: "federation", label: f.label, federation: f.federation, attrs: {} });
for (const m of MODULES) {
  upsertNode({ id: m.id, type: "module", label: m.label, federation: m.federation, attrs: {} });
  addEdge(m.federation, m.id, "contains", 1.0);
}
// Cross-federation edges
addEdge("ANUBIS", "BOOKPI", "logs_to", 0.9);
addEdge("ISABELLA", "BOOKPI", "logs_to", 0.85);
addEdge("OMNIGATEWAY", "ANUBIS", "enforces_via", 1.0);
addEdge("OMNIGATEWAY", "ISABELLA", "routes_to", 0.8);
addEdge("EOCT", "ATLAS-KERNEL", "feeds", 0.9);
addEdge("GEMET", "ATLAS-KERNEL", "ontology_for", 0.95);
addEdge("KORIMA", "BOOKPI", "records_decisions", 0.85);

emitEvent({
  type: "system.boot",
  source: "EOCT",
  payload: { nodes: nodes.size, edges: edges.length },
});
