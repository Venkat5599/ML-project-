"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, AlertRow, Summary } from "@/lib/api";

const LABEL_STYLE: Record<string, string> = {
  illicit: "text-red-400",
  licit: "text-sky-400",
  unknown: "text-zinc-500",
};

const PAGE_SIZE = 100;

function fmt(n: number | null | undefined, d = 3) {
  return n == null ? "-" : n.toFixed(d);
}

function ScoreCell({ v }: { v: number }) {
  const hot = v >= 0.7;
  return (
    <div className="w-20">
      <div className={`font-mono ${hot ? "text-amber-300" : "text-zinc-300"}`}>
        {v.toFixed(3)}
      </div>
      <div className="mt-0.5 h-px bg-zinc-800">
        <div
          className={`h-px ${hot ? "bg-amber-500" : "bg-zinc-500"}`}
          style={{ width: `${Math.min(100, v * 100)}%` }}
        />
      </div>
    </div>
  );
}

function SkeletonRows() {
  return (
    <>
      {Array.from({ length: 12 }).map((_, i) => (
        <tr key={i} className="border-t border-zinc-800/50">
          {["w-24", "w-8", "w-14", "w-16", "w-12", "w-12"].map((w, j) => (
            <td key={j} className="px-3 py-2.5">
              <div className={`h-3 animate-pulse bg-zinc-800/70 ${w}`} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

export default function AlertCenter() {
  const router = useRouter();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [rows, setRows] = useState<AlertRow[]>([]);
  const [total, setTotal] = useState(0);
  const [minScore, setMinScore] = useState(0.5);
  const [label, setLabel] = useState("all");
  const [steps, setSteps] = useState<[number, number]>([35, 49]);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.summary().then(setSummary).catch((e) => setErr(String(e)));
  }, []);

  useEffect(() => {
    setLoading(true);
    api
      .alerts({
        min_score: minScore,
        label,
        step_min: steps[0],
        step_max: steps[1],
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      })
      .then((r) => {
        setRows(r.rows);
        setTotal(r.total);
        setErr(null);
      })
      .catch((e) => setErr(String(e)))
      .finally(() => setLoading(false));
  }, [minScore, label, steps, page]);

  // scores are sorted desc, so page 0 rows ARE the global top of the queue
  const top100 = useMemo(
    () => (page === 0 ? rows.filter((r) => r.label !== "unknown").slice(0, 100) : []),
    [rows, page]
  );
  const p100 = page === 0 && top100.length
    ? top100.filter((r) => r.label === "illicit").length / top100.length
    : null;

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function goSearch(e: React.FormEvent) {
    e.preventDefault();
    const id = Number(search.replace(/\D/g, ""));
    if (id) router.push(`/tx/${id}`);
  }

  function setFilter<T>(setter: (v: T) => void) {
    return (v: T) => {
      setPage(0);
      setter(v);
    };
  }

  return (
    <main className="mx-auto max-w-7xl px-6 py-5">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-4 border-b border-zinc-800 pb-4">
        <div>
          <h1 className="font-mono text-xl font-semibold tracking-tight">
            ChainSleuth <span className="text-amber-500">AML</span>
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Suspicious-transaction triage, Elliptic test window (steps 35-49).
            Scores rank suspicion, not proven criminality.
          </p>
        </div>
        <form onSubmit={goSearch} className="flex">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="jump to tx_id"
            className="w-48 border border-r-0 border-zinc-700 bg-zinc-950 px-3 py-1.5 font-mono text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-amber-600"
          />
          <button
            type="submit"
            className="border border-amber-700 bg-amber-950/40 px-3 py-1.5 font-mono text-xs text-amber-300 hover:bg-amber-950"
          >
            inspect
          </button>
        </form>
      </header>

      {err && (
        <div className="mb-4 border border-red-900 bg-red-950/40 px-4 py-2 font-mono text-xs text-red-300">
          backend unreachable: {err}. Start it with `uvicorn backend.main:app --port 8000`
        </div>
      )}

      <section className="mb-5 grid grid-cols-2 gap-px border border-zinc-800 bg-zinc-800 md:grid-cols-4">
        {[
          ["FLAGGED IN VIEW", total.toLocaleString()],
          [
            "LABELED ILLICIT",
            rows.filter((r) => r.label === "illicit").length.toLocaleString(),
          ],
          ["TOP-100 PRECISION", p100 == null ? "-" : `${(p100 * 100).toFixed(0)}%`],
          [
            "UNLABELED SCORED",
            rows.filter((r) => r.label === "unknown").length.toLocaleString(),
          ],
        ].map(([k, v]) => (
          <div key={k} className="bg-zinc-950 px-4 py-3">
            <div className="font-mono text-lg text-zinc-100">{v}</div>
            <div className="font-mono text-[10px] text-zinc-500">{k}</div>
          </div>
        ))}
      </section>

      <section className="mb-4 flex flex-wrap items-end gap-6">
        <label className="flex flex-col gap-1.5">
          <span className="font-mono text-[11px] text-zinc-500">
            MIN SCORE <span className="text-amber-400">{minScore.toFixed(2)}</span>
          </span>
          <input
            type="range" min={0} max={1} step={0.05} value={minScore}
            onChange={(e) => setFilter(setMinScore)(Number(e.target.value))}
            className="w-44 accent-amber-500"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="font-mono text-[11px] text-zinc-500">LABEL</span>
          <select
            value={label}
            onChange={(e) => setFilter(setLabel)(e.target.value)}
            className="border border-zinc-700 bg-zinc-950 px-2 py-1 font-mono text-xs text-zinc-200"
          >
            {["all", "illicit", "licit", "unknown"].map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="font-mono text-[11px] text-zinc-500">
            TIME STEPS <span className="text-zinc-300">{steps[0]} to {steps[1]}</span>
          </span>
          <div className="flex items-center gap-2">
            <input
              type="range" min={35} max={49} value={steps[0]}
              onChange={(e) =>
                setFilter(setSteps)([Math.min(Number(e.target.value), steps[1]), steps[1]])
              }
              className="w-24 accent-zinc-500"
            />
            <input
              type="range" min={35} max={49} value={steps[1]}
              onChange={(e) =>
                setFilter(setSteps)([steps[0], Math.max(Number(e.target.value), steps[0])])
              }
              className="w-24 accent-zinc-500"
            />
          </div>
        </label>
        <div className="ml-auto flex items-center gap-2 font-mono text-xs text-zinc-500">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0 || loading}
            className="border border-zinc-700 px-3 py-1 text-zinc-300 enabled:hover:border-zinc-500 disabled:opacity-30"
          >
            prev
          </button>
          <span>
            {page + 1} / {pages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}
            disabled={page >= pages - 1 || loading}
            className="border border-zinc-700 px-3 py-1 text-zinc-300 enabled:hover:border-zinc-500 disabled:opacity-30"
          >
            next
          </button>
        </div>
      </section>

      <div className="overflow-x-auto border border-zinc-800">
        <table className="w-full text-left font-mono text-xs">
          <thead className="bg-zinc-900/80 text-[10px] uppercase tracking-wider text-zinc-500">
            <tr>
              {["tx_id", "step", "label", "hybrid", "xgb", "gnn"].map((h) => (
                <th key={h} className="px-3 py-2.5 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <SkeletonRows />
            ) : (
              rows.map((r) => (
                <tr
                  key={r.tx_id}
                  onClick={() => router.push(`/tx/${r.tx_id}`)}
                  className="cursor-pointer border-t border-zinc-800/50 transition-colors hover:bg-zinc-900/50"
                >
                  <td className="px-3 py-2">
                    <Link
                      href={`/tx/${r.tx_id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="text-zinc-200 hover:text-amber-300 hover:underline"
                    >
                      {r.tx_id}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-zinc-500">{r.time_step}</td>
                  <td className={`px-3 py-2 ${LABEL_STYLE[r.label]}`}>{r.label}</td>
                  <td className="px-3 py-2"><ScoreCell v={r.score} /></td>
                  <td className="px-3 py-2 text-zinc-400">{fmt(r.xgb)}</td>
                  <td className="px-3 py-2 text-zinc-400">{fmt(r.gnn)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        {!loading && rows.length === 0 && !err && (
          <div className="px-4 py-10 text-center text-sm text-zinc-600">
            no alerts match filters
          </div>
        )}
      </div>
      <p className="mt-2 font-mono text-[11px] text-zinc-600">
        {total.toLocaleString()} alerts match. click a row to open the investigation view.
      </p>
    </main>
  );
}
