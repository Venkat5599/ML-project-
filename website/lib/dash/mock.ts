/**
 * Mock investigation data for the console. Deterministic (seeded) so the static export
 * and the first client render agree. Nothing here comes from the trained models.
 */

export type Label = "illicit" | "licit" | "unknown";
export type Status = "new" | "reviewing" | "escalated" | "cleared";
export type CaseStatus = "open" | "in review" | "closed";

export interface Shap {
  feature: string;
  value: number;
  shap: number;
}
export interface Note {
  at: number;
  by: string;
  text: string;
}
export interface Alert {
  id: number;
  step: number;
  label: Label;
  hybrid: number;
  xgb: number;
  gnn: number;
  ae: number;
  iso: number;
  status: Status;
  assignee: string | null;
  caseId: string | null;
  inDeg: number;
  outDeg: number;
  shap: Shap[];
  notes: Note[];
  flaggedAt: number;
}
export interface Case {
  id: string;
  title: string;
  status: CaseStatus;
  owner: string;
  createdAt: number;
  txs: number[];
  notes: Note[];
}
export interface Activity {
  at: number;
  who: string;
  text: string;
  tone: "info" | "warn" | "ok" | "bad";
}

export const ANALYSTS = ["A. Rao", "M. Chen", "S. Iyer", "J. Okafor"];
export const BASE_TIME = Date.UTC(2026, 10, 15, 9, 0, 0);

export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FEATURES = [
  "local_53", "local_55", "local_90", "agg_70", "local_59", "local_46", "local_67",
  "local_89", "local_91", "local_52", "agg_57", "local_2", "agg_21", "local_83", "agg_63",
];

const r4 = (x: number) => Math.round(x * 10000) / 10000;

function shapFor(r: () => number, hybrid: number): Shap[] {
  const picks = [...FEATURES].sort(() => r() - 0.5).slice(0, 6);
  return picks
    .map((f, i) => {
      const push = (r() * 1.6 + 0.15) * (i === 0 ? 1.4 : 1) * (r() < 0.25 + (1 - hybrid) * 0.4 ? -1 : 1);
      return { feature: f, value: r4(r() * 4 - 1.2), shap: r4(push) };
    })
    .sort((a, b) => Math.abs(b.shap) - Math.abs(a.shap));
}

export function makeAlerts(n = 240): Alert[] {
  const r = rng(20261115);
  const out: Alert[] = [];
  const used = new Set<number>();
  for (let i = 0; i < n; i++) {
    let id = Math.floor(1_000_000 + r() * 299_000_000);
    while (used.has(id)) id += 7;
    used.add(id);
    const u = r();
    const label: Label = u < 0.13 ? "illicit" : u < 0.42 ? "licit" : "unknown";
    const v = r();
    const hybrid = label === "illicit" ? 0.62 + v * 0.375 : label === "unknown" ? 0.22 + Math.pow(v, 0.8) * 0.76 : 0.06 + v * 0.62;
    const xgb = Math.min(0.999, Math.max(0.001, hybrid + (r() - 0.5) * 0.18));
    const gnn = Math.min(0.999, Math.max(0.001, hybrid + (r() - 0.5) * 0.45));
    const s = r();
    const status: Status = s < 0.68 ? "new" : s < 0.84 ? "reviewing" : s < 0.92 ? "escalated" : "cleared";
    out.push({
      id,
      step: 35 + Math.floor(r() * 15),
      label,
      hybrid: r4(hybrid),
      xgb: r4(xgb),
      gnn: r4(gnn),
      ae: r4(Math.min(1, r() * 0.5 + hybrid * 0.3)),
      iso: r4(Math.min(1, r() * 0.4 + hybrid * 0.2)),
      status,
      assignee: status === "new" ? null : ANALYSTS[Math.floor(r() * ANALYSTS.length)],
      caseId: null,
      inDeg: 1 + Math.floor(r() * 5),
      outDeg: 1 + Math.floor(r() * 6),
      shap: shapFor(r, hybrid),
      notes: [],
      flaggedAt: BASE_TIME - Math.floor(r() * 72 * 3600_000),
    });
  }
  return out.sort((a, b) => b.hybrid - a.hybrid);
}

export function makeCases(alerts: Alert[]): Case[] {
  const esc = alerts.filter((a) => a.status === "escalated");
  const groups: [string, string, CaseStatus][] = [
    ["CS-1041", "Peel chain through step 41 hubs", "open"],
    ["CS-1042", "Fan-out from unlabelled cluster", "in review"],
    ["CS-1043", "Mixer-like merge pattern", "open"],
  ];
  return groups.map(([id, title, status], gi) => {
    const txs = esc.filter((_, i) => i % groups.length === gi).map((a) => a.id);
    txs.forEach((t) => {
      const a = alerts.find((x) => x.id === t);
      if (a) a.caseId = id;
    });
    return {
      id,
      title,
      status,
      owner: ANALYSTS[gi % ANALYSTS.length],
      createdAt: BASE_TIME - (gi + 1) * 9 * 3600_000,
      txs,
      notes: [{ at: BASE_TIME - (gi + 1) * 8 * 3600_000, by: ANALYSTS[gi % ANALYSTS.length], text: "Opened from the alert queue." }],
    };
  });
}

export function makeActivity(alerts: Alert[]): Activity[] {
  const esc = alerts.find((x) => x.status === "escalated" && x.caseId)!;
  const clr = alerts.find((x) => x.status === "cleared")!;
  const rev = alerts.find((x) => x.status === "reviewing")!;
  return [
    { at: BASE_TIME - 12 * 60_000, who: esc.assignee ?? "M. Chen", text: `escalated tx ${esc.id} to ${esc.caseId}`, tone: "bad" },
    { at: BASE_TIME - 40 * 60_000, who: clr.assignee ?? "S. Iyer", text: `cleared tx ${clr.id} as a false positive`, tone: "ok" },
    { at: BASE_TIME - 95 * 60_000, who: rev.assignee ?? "A. Rao", text: `started reviewing tx ${rev.id}`, tone: "info" },
    { at: BASE_TIME - 3 * 3600_000, who: "pipeline", text: "scored 240 new test-window transactions", tone: "info" },
    { at: BASE_TIME - 5 * 3600_000, who: "J. Okafor", text: "opened CS-1043", tone: "warn" },
  ];
}

export interface GraphNode {
  id: number;
  hop: number;
  label: Label;
  score: number | null;
}
export interface GraphEdge {
  from: number;
  to: number;
}

/** Deterministic neighbourhood for any transaction id: predecessors at negative hops, successors at positive. */
export function neighbourhood(center: number, hops: 1 | 2, known: Map<number, Alert>): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes = new Map<number, GraphNode>();
  const edges: GraphEdge[] = [];
  const nodeFor = (id: number, hop: number): GraphNode => {
    const k = known.get(id);
    if (k) return { id, hop, label: k.label, score: k.hybrid };
    const r = rng(id);
    const u = r();
    const label: Label = u < 0.12 ? "illicit" : u < 0.45 ? "licit" : "unknown";
    return { id, hop, label, score: r() < 0.85 ? r4(label === "illicit" ? 0.6 + r() * 0.4 : r() * 0.7) : null };
  };
  nodes.set(center, nodeFor(center, 0));
  const grow = (from: number, dir: 1 | -1, hop: number) => {
    const r = rng(from * 31 + (dir > 0 ? 7 : 13));
    const n = hop === 1 ? 1 + Math.floor(r() * 4) : Math.floor(r() * 3);
    for (let i = 0; i < n; i++) {
      const id = Math.floor(1_000_000 + r() * 299_000_000);
      if (nodes.has(id)) continue;
      nodes.set(id, nodeFor(id, dir * hop));
      edges.push(dir > 0 ? { from, to: id } : { from: id, to: from });
      if (hop < hops) grow(id, dir, hop + 1);
    }
  };
  grow(center, 1, 1);
  grow(center, -1, 1);
  return { nodes: [...nodes.values()], edges };
}
