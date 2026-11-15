"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { makeActivity, makeAlerts, makeCases, type Activity, type Alert, type Case, type Status } from "./mock";

export interface Settings {
  threshold: number;
  budget: number;
  analyst: string;
  notifyEscalations: boolean;
  autoAssign: boolean;
}

interface State {
  alerts: Alert[];
  cases: Case[];
  activity: Activity[];
  settings: Settings;
  query: string;
  focus: number | null;
  setQuery: (q: string) => void;
  setFocus: (id: number | null) => void;
  assign: (ids: number[], who?: string) => void;
  setStatus: (ids: number[], status: Status) => void;
  escalate: (ids: number[], caseId: string | "new", title?: string) => string;
  addNote: (id: number, text: string) => void;
  createCase: (title: string, txs?: number[]) => string;
  setCaseStatus: (id: string, status: Case["status"]) => void;
  addCaseNote: (id: string, text: string) => void;
  removeFromCase: (caseId: string, tx: number) => void;
  updateSettings: (s: Partial<Settings>) => void;
  reset: () => void;
}

function fresh() {
  const alerts = makeAlerts();
  const cases = makeCases(alerts);
  return { alerts, cases, activity: makeActivity(alerts) };
}

const DEFAULT_SETTINGS: Settings = { threshold: 0.5, budget: 100, analyst: "You", notifyEscalations: true, autoAssign: false };

export const useDash = create<State>()(
  persist(
    (set, get) => {
      const log = (text: string, tone: Activity["tone"] = "info") =>
        set((s) => ({ activity: [{ at: Date.now(), who: s.settings.analyst, text, tone }, ...s.activity].slice(0, 60) }));
      const nextCaseId = () => {
        const n = Math.max(1040, ...get().cases.map((c) => Number(c.id.split("-")[1]) || 0)) + 1;
        return `CS-${n}`;
      };
      return {
        ...fresh(),
        settings: DEFAULT_SETTINGS,
        query: "",
        focus: null,
        setQuery: (query) => set({ query }),
        setFocus: (focus) => set({ focus }),
        assign: (ids, who) => {
          const name = who ?? get().settings.analyst;
          set((s) => ({
            alerts: s.alerts.map((a) =>
              ids.includes(a.id) ? { ...a, assignee: name, status: a.status === "new" ? "reviewing" : a.status } : a,
            ),
          }));
          log(ids.length === 1 ? `took tx ${ids[0]} for review` : `took ${ids.length} alerts for review`);
        },
        setStatus: (ids, status) => {
          set((s) => ({
            alerts: s.alerts.map((a) =>
              ids.includes(a.id) ? { ...a, status, assignee: a.assignee ?? s.settings.analyst, caseId: status === "escalated" ? a.caseId : a.caseId } : a,
            ),
          }));
          const what = status === "cleared" ? "cleared" : status === "new" ? "reopened" : status === "reviewing" ? "started reviewing" : "escalated";
          log(ids.length === 1 ? `${what} tx ${ids[0]}` : `${what} ${ids.length} alerts`, status === "cleared" ? "ok" : status === "escalated" ? "bad" : "info");
        },
        escalate: (ids, caseId, title) => {
          const id = caseId === "new" ? get().createCase(title || `Case from tx ${ids[0]}`, []) : caseId;
          set((s) => ({
            alerts: s.alerts.map((a) => (ids.includes(a.id) ? { ...a, status: "escalated", caseId: id, assignee: a.assignee ?? s.settings.analyst } : a)),
            cases: s.cases.map((c) =>
              c.id === id ? { ...c, txs: [...new Set([...c.txs, ...ids])], status: c.status === "closed" ? "open" : c.status } : c,
            ),
          }));
          log(ids.length === 1 ? `escalated tx ${ids[0]} to ${id}` : `escalated ${ids.length} alerts to ${id}`, "bad");
          return id;
        },
        addNote: (id, text) => {
          set((s) => ({
            alerts: s.alerts.map((a) => (a.id === id ? { ...a, notes: [...a.notes, { at: Date.now(), by: s.settings.analyst, text }] } : a)),
          }));
          log(`noted on tx ${id}`);
        },
        createCase: (title, txs = []) => {
          const id = nextCaseId();
          set((s) => ({
            cases: [
              { id, title, status: "open", owner: s.settings.analyst, createdAt: Date.now(), txs, notes: [] },
              ...s.cases,
            ],
          }));
          log(`opened ${id}`, "warn");
          return id;
        },
        setCaseStatus: (id, status) => {
          set((s) => ({ cases: s.cases.map((c) => (c.id === id ? { ...c, status } : c)) }));
          log(`${status === "closed" ? "closed" : status === "open" ? "reopened" : "moved to review"} ${id}`, status === "closed" ? "ok" : "info");
        },
        addCaseNote: (id, text) => {
          set((s) => ({
            cases: s.cases.map((c) => (c.id === id ? { ...c, notes: [...c.notes, { at: Date.now(), by: s.settings.analyst, text }] } : c)),
          }));
          log(`noted on ${id}`);
        },
        removeFromCase: (caseId, tx) => {
          set((s) => ({
            cases: s.cases.map((c) => (c.id === caseId ? { ...c, txs: c.txs.filter((t) => t !== tx) } : c)),
            alerts: s.alerts.map((a) => (a.id === tx && a.caseId === caseId ? { ...a, caseId: null, status: "reviewing" } : a)),
          }));
          log(`removed tx ${tx} from ${caseId}`);
        },
        updateSettings: (p) => set((s) => ({ settings: { ...s.settings, ...p } })),
        reset: () => set({ ...fresh(), settings: DEFAULT_SETTINGS, query: "", focus: null }),
      };
    },
    {
      name: "chainsleuth-console-mock",
      version: 1,
      skipHydration: true,
      partialize: (s) => ({ alerts: s.alerts, cases: s.cases, activity: s.activity, settings: s.settings }),
    },
  ),
);

/** Alerts at or above the configured score threshold. */
export function inQueue(alerts: Alert[], threshold: number) {
  return alerts.filter((a) => a.hybrid >= threshold);
}
