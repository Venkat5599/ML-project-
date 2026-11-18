/** Shapes returned by the FastAPI backend (backend/main.py, backend/workflow.py). */

export type Label = "illicit" | "licit" | "unknown";
export type Status = "new" | "reviewing" | "escalated" | "cleared";
export type CaseStatus = "open" | "in review" | "closed";

export interface Note {
  at: number;
  by: string;
  text: string;
}

/** One test-window transaction with its model scores and analyst state. */
export interface Alert {
  id: number;
  step: number;
  label: Label;
  /** Calibrated hybrid ensemble score (falls back to the raw blend). */
  hybrid: number | null;
  xgb: number | null;
  gnn: number | null;
  rf: number | null;
  /** Autoencoder reconstruction error, as a percentile within the test window. */
  ae: number | null;
  /** Isolation-forest score, as a percentile within the test window. */
  iso: number | null;
  inDeg: number;
  outDeg: number;
  status: Status;
  assignee: string | null;
  caseId: string | null;
  notes: Note[];
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

export interface Settings {
  threshold: number;
  budget: number;
  analyst: string;
  notifyEscalations: boolean;
  autoAssign: boolean;
}

export interface Snapshot {
  alerts: Alert[];
  cases: Case[];
  activity: Activity[];
  settings: Settings;
  window: { n_scored: number; steps: [number, number]; limit: number; above_threshold: number };
  caseId?: string;
}

export interface Shap {
  feature: string;
  value: number;
  shap: number;
}

export interface Explanation {
  tx_id: number;
  model: string;
  contributions: Shap[];
}

export type Window = "train" | "validation" | "test" | "unknown";

export interface ScoredRow {
  row: number;
  tx_id: number | null;
  time_step: number | null;
  window: Window;
  /** The saved models were fit on steps 1-34, so these scores are optimistic. */
  in_sample: boolean;
  xgb: number;
  rf: number | null;
  reasons: Shap[];
  label: Label;
}

export interface TxScore extends ScoredRow {
  hybrid: number | null;
  in_degree: number;
  out_degree: number;
}

export interface BatchScore {
  n: number;
  n_flagged: number;
  n_in_sample: number;
  rows: ScoredRow[];
}

export interface GraphNode {
  id: number;
  label: Label;
  is_center: boolean;
  hop: number;
  degree: number;
  time_step: number;
  score: number | null;
}

export interface FlowGraph {
  nodes: GraphNode[];
  links: { source: number; target: number }[];
}
