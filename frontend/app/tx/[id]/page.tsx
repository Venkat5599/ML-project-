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
        <main className="mx-auto max-w-7xl px-6 py-10 text-sm text-zinc-500">
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
      <main className="mx-auto max-w-7xl px-6 py-10 font-mono text-sm text-red-300">
        {err}. <Link href="/" className="underline">back to alerts</Link>
      </main>
    );
  }
  if (!tx) {
    return (
      <main className="mx-auto max-w-7xl px-6 py-10 text-sm text-zinc-500">loading</main>
    );
  }

  const hybrid = tx.scores.hybrid_calibrated ?? tx.scores.hybrid;

  return (
    <main className="mx-auto max-w-7xl px-6 py-5">
      {/* header strip */}
      <div className="mb-4 flex flex-wrap items-center gap-3 border-b border-zinc-800 pb-4">
        <Link
          href="/"
          className="font-mono text-xs text-zinc-500 hover:text-zinc-200"
        >
          {"<- alerts"}
        </Link>
        <h1 className="font-mono text-lg font-semibold text-zinc-100">
          tx {tx.tx_id}
        </h1>
        <span
          className={`border px-2 py-0.5 font-mono text-xs ${LABEL_STYLE[tx.label] ?? ""}`}
        >
          {tx.label}
        </span>
        <span className="font-mono text-xs text-zinc-500">step {tx.time_step}</span>
        <div className="ml-auto flex items-baseline gap-2">
          <span className="text-xs text-zinc-500">hybrid score</span>
          <span className="font-mono text-2xl font-semibold text-amber-400">
            {hybrid?.toFixed(3)}
          </span>
        </div>
      </div>

      {/* graph is the hero */}
      <div className="mb-3 flex items-center gap-4">
        <span className="font-mono text-xs text-zinc-500">FUND FLOW</span>
        <div className="flex font-mono text-xs">
          {[1, 2].map((h) => (
            <button
              key={h}
              onClick={() => setHops(h)}
              className={`border px-3 py-1 ${
                hops === h
                  ? "border-amber-600 bg-amber-950/40 text-amber-300"
                  : "border-zinc-700 text-zinc-500 hover:text-zinc-300"
              } ${h === 1 ? "border-r-0" : ""}`}
            >
              {h} hop{h > 1 ? "s" : ""}
            </button>
          ))}
        </div>
        <div className="ml-auto flex gap-4 font-mono text-[11px] text-zinc-500">
          <span className="flex items-center gap-1.5">
            <i className="inline-block h-2.5 w-2.5 rounded-full border-[1.5px] border-red-500" />
            illicit
          </span>
          <span className="flex items-center gap-1.5">
            <i className="inline-block h-2.5 w-2.5 rounded-full border-[1.5px] border-sky-400" />
            licit
          </span>
          <span className="flex items-center gap-1.5">
            <i className="inline-block h-2.5 w-2.5 rounded-full border-[1.5px] border-zinc-500" />
            unknown
          </span>
          <span className="flex items-center gap-1.5">
            <i className="inline-block h-2.5 w-2.5 rounded-full bg-amber-500" />
            selected
          </span>
        </div>
      </div>

      {graph ? (
        <NetworkGraph data={graph} />
      ) : (
        <div className="flex h-[560px] items-center justify-center border border-zinc-800 bg-[#060a12] text-sm text-zinc-600">
          {tx.label === "unknown" && !graph ? "loading neighbourhood" : "no graph neighbours"}
        </div>
      )}
      <p className="mt-2 font-mono text-[11px] text-zinc-600">
        click a node to pivot the investigation to that transaction. arrows point
        in the direction funds move.
      </p>

      {/* evidence panels */}
      <div className="mt-8 grid gap-px border border-zinc-800 bg-zinc-800 md:grid-cols-2">
        <section className="bg-zinc-950 p-5">
          <h2 className="mb-3 font-mono text-xs text-zinc-500">MODEL SCORES</h2>
          <ScoreBars scores={tx.scores} />
          <div className="mt-2 grid grid-cols-2 gap-x-6 font-mono text-xs">
            {Object.entries(tx.scores).map(([k, v]) => (
              <div
                key={k}
                className="flex justify-between border-b border-zinc-800/50 py-1"
              >
                <span className="text-zinc-500">{k}</span>
                <span className="text-zinc-200">{v.toFixed(4)}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="bg-zinc-950 p-5">
          <h2 className="mb-3 font-mono text-xs text-zinc-500">
            TOP SHAP CONTRIBUTIONS (XGBOOST)
          </h2>
          {contrib.length ? (
            <>
              <ShapChart items={contrib} />
              <p className="mt-2 text-xs text-zinc-600">
                red pushes toward suspicious, blue pushes away. attributions are
                model explanations, not proof of criminality.
              </p>
            </>
          ) : (
            <p className="text-sm text-zinc-600">explanation unavailable</p>
          )}
        </section>
      </div>
    </main>
  );
}
