const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export type AlertRow = {
  tx_id: number;
  time_step: number;
  label: "illicit" | "licit" | "unknown";
  score: number;
  xgb: number | null;
  gnn: number | null;
};

export type TxDetail = {
  tx_id: number;
  time_step: number;
  label: string;
  scores: Record<string, number>;
};

export type Contribution = { feature: string; shap: number; value: number };

export type GraphNode = {
  id: number;
  label: string;
  is_center: boolean;
  hop: number;
  degree: number;
  time_step: number;
  score: number | null;
};

export type GraphData = {
  nodes: GraphNode[];
  links: { source: number | GraphNode; target: number | GraphNode }[];
};

export type Summary = {
  n_scored: number;
  n_labeled_illicit: number;
  n_labeled_licit: number;
  n_unknown: number;
  time_steps: number[];
};

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

export const api = {
  summary: () => get<Summary>("/api/summary"),
  alerts: (q: {
    min_score?: number;
    label?: string;
    step_min?: number;
    step_max?: number;
    limit?: number;
    offset?: number;
  }) => {
    const p = new URLSearchParams(
      Object.entries(q).map(([k, v]) => [k, String(v)])
    );
    return get<{ total: number; rows: AlertRow[] }>(`/api/alerts?${p}`);
  },
  tx: (id: number) => get<TxDetail>(`/api/tx/${id}`),
  explain: (id: number) =>
    get<{ contributions: Contribution[] }>(`/api/tx/${id}/explain`),
  graph: (id: number, hops: number) =>
    get<GraphData>(`/api/tx/${id}/graph?hops=${hops}`),
};
