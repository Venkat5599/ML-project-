import type { Explanation, FlowGraph, Settings, Snapshot } from "./types";

/**
 * The console is a static export, so the browser talks to the local FastAPI
 * backend directly (CORS allows the 4430 dev/serve port). 127.0.0.1, not
 * localhost: Windows resolves localhost to ::1 first and uvicorn binds IPv4.
 */
export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000").replace(/\/$/, "");

export class ApiError extends Error {
  constructor(
    public kind: "offline" | "rejected" | "not_found" | "server",
    message: string,
    public status?: number,
  ) {
    super(message);
  }
}

async function call<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: init?.method ?? "GET",
      headers: init?.body !== undefined ? { "content-type": "application/json" } : undefined,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
    });
  } catch {
    throw new ApiError("offline", `Backend not reachable at ${API_URL}`);
  }
  if (res.ok) return (await res.json()) as T;
  let detail = res.statusText;
  try {
    const body = await res.json();
    if (typeof body?.detail === "string") detail = body.detail;
  } catch {
    /* non-JSON error body */
  }
  const kind = res.status === 404 ? "not_found" : res.status < 500 ? "rejected" : "server";
  throw new ApiError(kind, detail, res.status);
}

const post = <T>(path: string, body: unknown = {}) => call<T>(path, { method: "POST", body });

export const api = {
  snapshot: (limit = 500) => call<Snapshot>(`/api/console?limit=${limit}`),
  assign: (ids: number[], who?: string) => post<Snapshot>("/api/console/alerts/assign", { ids, who }),
  setStatus: (ids: number[], status: string) => post<Snapshot>("/api/console/alerts/status", { ids, status }),
  escalate: (ids: number[], caseId: string, title?: string) =>
    post<Snapshot>("/api/console/alerts/escalate", { ids, caseId, title }),
  addNote: (id: number, text: string) => post<Snapshot>(`/api/console/alerts/${id}/notes`, { text }),
  createCase: (title: string, txs: number[] = []) => post<Snapshot>("/api/console/cases", { title, txs }),
  setCaseStatus: (id: string, status: string) =>
    post<Snapshot>(`/api/console/cases/${encodeURIComponent(id)}/status`, { status }),
  addCaseNote: (id: string, text: string) => post<Snapshot>(`/api/console/cases/${encodeURIComponent(id)}/notes`, { text }),
  removeFromCase: (id: string, tx: number) =>
    call<Snapshot>(`/api/console/cases/${encodeURIComponent(id)}/txs/${tx}`, { method: "DELETE" }),
  updateSettings: (patch: Partial<Settings>) => call<Snapshot>("/api/console/settings", { method: "PUT", body: patch }),
  reset: () => post<Snapshot>("/api/console/reset"),
  explain: (id: number) => call<Explanation>(`/api/tx/${id}/explain?top=10`),
  graph: (id: number, hops: 1 | 2) => call<FlowGraph>(`/api/tx/${id}/graph?hops=${hops}&max_nodes=60`),
};
