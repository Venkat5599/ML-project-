"use client";

import { Suspense, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api, Contribution, GraphData, TxDetail } from "@/lib/api";
import { ScoreBars, ShapChart } from "@/components/Charts";
import NetworkGraph from "@/components/NetworkGraph";

const LABEL_STYLE: Record<string, string> = {
  illicit: "text-red-400 border-red-900/60 bg-red-950/30",
  licit: "text-sky-400 border-sky-900/60 bg-sky-950/30",
  unknown: "text-zinc-400 border-zinc-700 bg-zinc-900/40",
};

export default function TxPage() {
  return (
    <Suspense
      fallback={
        <main className="flex h-[100dvh] items-center justify-center bg-zinc-950 text-sm text-zinc-500">
          loading
        </main>
      }
    >
      <TxView />
    </Suspense>
  );
}

function TxView() {
  const { id } = useParams<{ id: string }>();
  const txId = Number(id);
  const [tx, setTx] = useState<TxDetail | null>(null);
  const [contrib, setContrib] = useState<Contribution[]>([]);
  const [graph, setGraph] = useState<GraphData | null>(null);
  const [hops, setHops] = useState(1);
  const [panel, setPanel] = useState<"scores" | "shap">("scores");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.tx(txId).then(setTx).catch((e) => setErr(String(e)));
    api.explain(txId).then((r) => setContrib(r.contributions)).catch(() => {});
  }, [txId]);

  useEffect(() => {
    setGraph(null);
    api.graph(txId, hops).then(setGraph).catch(() => setGraph(null));
  }, [txId, hops]);

  if (err) {
    return (
      <main className="flex h-[100dvh] items-center justify-center bg-zinc-950 font-mono text-sm text-red-300">
        {err}. <Link href="/" className="ml-2 underline">back to alerts</Link>
      </main>
    );
  }
  if (!tx) {
    return (
      <main className="flex h-[100dvh] items-center justify-center bg-zinc-950 text-sm text-zinc-500">
        loading
      </main>
    );
  }

  const hybrid = tx.scores.hybrid_calibrated ?? tx.scores.hybrid;
  const neighbors = graph
    ? [...graph.nodes].filter((n) => !n.is_center).sort((a, b) => b.degree - a.degree).slice(0, 8)
    : [];

  return (
    <main className="flex h-[100dvh] flex-col bg-zinc-950">
      {/* top bar */}
      <div className="flex flex-wrap items-center gap-3 border-b border-zinc-800 px-4 py-2.5">
        <Link href="/" className="font-mono text-xs text-zinc-500 hover:text-zinc-200">
          {"<- ChainSleuth"}
        </Link>
        <span className="font-mono text-sm font-semibold text-zinc-100">
          tx {tx.tx_id}
        </span>
        <span className={`border px-2 py-0.5 font-mono text-xs ${LABEL_STYLE[tx.label] ?? ""}`}>
          {tx.label}
        </span>
        <span className="font-mono text-xs text-zinc-500">step {tx.time_step}</span>
        <div className="ml-auto flex items-baseline gap-2">
          <span className="text-xs text-zinc-500">hybrid</span>
          <span className="font-mono text-lg font-semibold text-amber-400">
            {hybrid?.toFixed(3)}
          </span>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* left sidebar - metasleuth style */}
        <aside className="flex w-[300px] shrink-0 flex-col overflow-y-auto border-r border-zinc-800">
          {/* entity card */}
          <div className="border-b border-zinc-800 p-4">
            <div className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
              transaction
            </div>
            <div className="mt-1 break-all font-mono text-sm text-zinc-100">
              {tx.tx_id}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 font-mono text-xs">
              <div>
                <div className="text-zinc-600">label</div>
                <div className={tx.label === "illicit" ? "text-red-400" : tx.label === "licit" ? "text-sky-400" : "text-zinc-400"}>
                  {tx.label}
                </div>
              </div>
              <div>
                <div className="text-zinc-600">time step</div>
                <div className="text-zinc-200">{tx.time_step}</div>
              </div>
            </div>
            <div className="mt-3 border border-zinc-800 bg-[#0a0f1c] p-3">
              <div className="text-[10px] uppercase tracking-wider text-zinc-500">
                suspicion score
              </div>
              <div className="mt-1 font-mono text-3xl font-semibold text-amber-400">
                {hybrid?.toFixed(2) ?? "-"}
              </div>
              <div className="mt-1 h-1 bg-zinc-800">
                <div
                  className="h-1 bg-amber-500"
                  style={{ width: `${Math.min(100, (hybrid ?? 0) * 100)}%` }}
                />
              </div>
            </div>
          </div>

          {/* evidence tabs */}
          <div className="flex border-b border-zinc-800 font-mono text-[11px]">
            {(["scores", "shap"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setPanel(t)}
                className={`flex-1 border-r border-zinc-800 px-3 py-2 uppercase tracking-wider last:border-r-0 ${
                  panel === t
                    ? "bg-zinc-900 text-amber-300"
                    : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {t === "scores" ? "model scores" : "shap"}
              </button>
            ))}
          </div>
          <div className="border-b border-zinc-800 p-3">
            {panel === "scores" ? (
              <>
                <ScoreBars scores={tx.scores} />
                <div className="mt-2 font-mono text-[11px]">
                  {Object.entries(tx.scores).map(([k, v]) => (
                    <div key={k} className="flex justify-between border-b border-zinc-800/50 py-1">
                      <span className="text-zinc-500">{k}</span>
                      <span className="text-zinc-200">{v.toFixed(4)}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : contrib.length ? (
              <>
                <ShapChart items={contrib.slice(0, 10)} />
                <p className="mt-2 text-[11px] leading-snug text-zinc-600">
                  red pushes toward suspicious. attributions are model
                  explanations, not proof of criminality.
                </p>
              </>
            ) : (
              <p className="text-xs text-zinc-600">explanation unavailable</p>
            )}
          </div>

          {/* top connected nodes */}
          {neighbors.length > 0 && (
            <div className="p-3">
              <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-zinc-500">
                most connected
              </div>
              <div className="font-mono text-[11px]">
                {neighbors.map((n) => (
                  <Link
                    key={n.id}
                    href={`/tx/${n.id}`}
                    className="flex items-center justify-between border-b border-zinc-800/50 py-1.5 hover:bg-zinc-900/40"
                  >
                    <span className="text-zinc-300">{n.id}</span>
                    <span className="flex items-center gap-2">
                      <span className={n.label === "illicit" ? "text-red-400" : n.label === "licit" ? "text-sky-400" : "text-zinc-600"}>
                        {n.label}
                      </span>
                      <span className="text-zinc-600">deg {n.degree}</span>
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </aside>

        {/* canvas area */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-3 border-b border-zinc-800 px-3 py-2">
            <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
              fund flow
            </span>
            <div className="flex font-mono text-[11px]">
              {[1, 2].map((h) => (
                <button
                  key={h}
                  onClick={() => setHops(h)}
                  className={`border px-2.5 py-0.5 ${
                    hops === h
                      ? "border-amber-600 bg-amber-950/40 text-amber-300"
                      : "border-zinc-700 text-zinc-500 hover:text-zinc-300"
                  } ${h === 1 ? "border-r-0" : ""}`}
                >
                  {h} hop{h > 1 ? "s" : ""}
                </button>
              ))}
            </div>
            {graph && (
              <span className="font-mono text-[11px] text-zinc-600">
                {graph.nodes.length} nodes / {graph.links.length} flows
              </span>
            )}
            <div className="ml-auto flex gap-3 font-mono text-[10px] text-zinc-500">
              <span className="flex items-center gap-1.5">
                <i className="inline-block h-2 w-2 rounded-[3px] border border-red-400 bg-red-950/60" />
                illicit
              </span>
              <span className="flex items-center gap-1.5">
                <i className="inline-block h-2 w-2 rounded-[3px] border border-sky-400 bg-sky-950/60" />
                licit
              </span>
              <span className="flex items-center gap-1.5">
                <i className="inline-block h-2 w-2 rounded-[3px] border border-zinc-400 bg-zinc-800" />
                unknown
              </span>
              <span className="flex items-center gap-1.5">
                <i className="inline-block h-2 w-2 rounded-[3px] border border-amber-500 bg-amber-950/70" />
                selected
              </span>
            </div>
          </div>

          <div className="relative flex-1">
            {graph ? (
              <NetworkGraph data={graph} />
            ) : (
              <div className="flex h-full items-center justify-center bg-[#070b14] text-sm text-zinc-600">
                loading neighbourhood
              </div>
            )}
            <div className="pointer-events-none absolute bottom-2 left-3 font-mono text-[10px] text-zinc-600">
              click a node to pivot. arrows show fund direction. scroll to zoom, drag to pan.
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
