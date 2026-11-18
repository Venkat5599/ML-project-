"use client";

import { create } from "zustand";
import { toast } from "@/components/ui/toast";
import { api, ApiError, API_URL } from "./api";
import type { Activity, Alert, Case, CaseStatus, Explanation, Settings, Snapshot, Status } from "./types";

export type { Settings } from "./types";

type Conn = "loading" | "live" | "offline";

interface State {
  conn: Conn;
  error: string | null;
  alerts: Alert[];
  cases: Case[];
  activity: Activity[];
  settings: Settings;
  window: Snapshot["window"] | null;
  explanations: Record<number, Explanation | "loading" | "missing">;
  query: string;
  focus: number | null;
  load: () => Promise<void>;
  setQuery: (q: string) => void;
  setFocus: (id: number | null) => void;
  explain: (id: number) => Promise<void>;
  assign: (ids: number[], who?: string) => Promise<boolean>;
  setStatus: (ids: number[], status: Status) => Promise<boolean>;
  escalate: (ids: number[], caseId: string, title?: string) => Promise<string | null>;
  addNote: (id: number, text: string) => Promise<boolean>;
  createCase: (title: string, txs?: number[]) => Promise<string | null>;
  setCaseStatus: (id: string, status: CaseStatus) => Promise<boolean>;
  addCaseNote: (id: string, text: string) => Promise<boolean>;
  removeFromCase: (caseId: string, tx: number) => Promise<boolean>;
  updateSettings: (s: Partial<Settings>) => Promise<boolean>;
  reset: () => Promise<boolean>;
}

/** Held until the backend answers; pages render a loading/offline state, not these values. */
const PLACEHOLDER_SETTINGS: Settings = { threshold: 0.5, budget: 100, analyst: "Analyst", notifyEscalations: true, autoAssign: false };

function apply(s: Snapshot) {
  return { alerts: s.alerts, cases: s.cases, activity: s.activity, settings: s.settings, window: s.window, conn: "live" as Conn, error: null };
}

export const useDash = create<State>()((set, get) => {
  /** Run one mutation; on success swap in the returned snapshot, on failure toast why. */
  async function mutate(run: () => Promise<Snapshot>): Promise<Snapshot | null> {
    try {
      const snap = await run();
      set(apply(snap));
      return snap;
    } catch (e) {
      const err = e as ApiError;
      if (err.kind === "offline") set({ conn: "offline", error: err.message });
      toast.add({ title: err.kind === "offline" ? "Backend offline" : "Action refused", description: err.message, type: "error" });
      return null;
    }
  }

  return {
    conn: "loading",
    error: null,
    alerts: [],
    cases: [],
    activity: [],
    settings: PLACEHOLDER_SETTINGS,
    window: null,
    explanations: {},
    query: "",
    focus: null,

    load: async () => {
      try {
        set(apply(await api.snapshot()));
      } catch (e) {
        const err = e as ApiError;
        set({ conn: "offline", error: err.kind === "offline" ? `Backend not reachable at ${API_URL}` : err.message });
      }
    },
    setQuery: (query) => set({ query }),
    setFocus: (focus) => set({ focus }),

    explain: async (id) => {
      const cur = get().explanations[id];
      if (cur && cur !== "missing") return;
      set((s) => ({ explanations: { ...s.explanations, [id]: "loading" } }));
      try {
        const ex = await api.explain(id);
        set((s) => ({ explanations: { ...s.explanations, [id]: ex } }));
      } catch {
        set((s) => ({ explanations: { ...s.explanations, [id]: "missing" } }));
      }
    },

    assign: async (ids, who) => !!(await mutate(() => api.assign(ids, who))),
    setStatus: async (ids, status) => !!(await mutate(() => api.setStatus(ids, status))),
    escalate: async (ids, caseId, title) => (await mutate(() => api.escalate(ids, caseId, title)))?.caseId ?? null,
    addNote: async (id, text) => !!(await mutate(() => api.addNote(id, text))),
    createCase: async (title, txs) => (await mutate(() => api.createCase(title, txs)))?.caseId ?? null,
    setCaseStatus: async (id, status) => !!(await mutate(() => api.setCaseStatus(id, status))),
    addCaseNote: async (id, text) => !!(await mutate(() => api.addCaseNote(id, text))),
    removeFromCase: async (caseId, tx) => !!(await mutate(() => api.removeFromCase(caseId, tx))),
    updateSettings: async (p) => !!(await mutate(() => api.updateSettings(p))),
    reset: async () => !!(await mutate(() => api.reset())),
  };
});

/** Alerts at or above the configured score threshold. */
export function inQueue(alerts: Alert[], threshold: number) {
  return alerts.filter((a) => (a.hybrid ?? 0) >= threshold);
}
