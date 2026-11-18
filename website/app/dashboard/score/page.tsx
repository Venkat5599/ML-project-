"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { Download, FileUp, Network, Search, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast";
import { Kpi, LabelBadge, ScoreBar } from "@/components/dash/bits";
import { api, ApiError } from "@/lib/dash/api";
import { fmt3, fmtInt } from "@/lib/dash/format";
import { useDash } from "@/lib/dash/store";
import type { BatchScore, Shap, TxScore, Window } from "@/lib/dash/types";
import { cn } from "@/lib/utils";

const PAGE = 20;
const SAMPLE_LABELS = [
  { value: "illicit", label: "Illicit rows" },
  { value: "licit", label: "Licit rows" },
  { value: "unknown", label: "Unlabelled rows" },
  { value: "any", label: "Any rows" },
] as const;
type SampleLabel = (typeof SAMPLE_LABELS)[number]["value"];

const WINDOW_TEXT: Record<Window, string> = {
  train: "training window (steps 1–29)",
  validation: "validation window (steps 30–34)",
  test: "held-out test window (steps 35–49)",
  unknown: "no time step given",
};

function WindowNote({ window, inSample }: { window: Window; inSample: boolean }) {
  return (
    <p className={cn("text-xs", inSample ? "text-warning" : "text-muted-foreground")}>
      {inSample
        ? `A labelled row from the ${WINDOW_TEXT[window]}: the saved models were fit on it, so this score is in-sample and optimistic.`
        : window === "test"
          ? `From the ${WINDOW_TEXT.test}: the models never saw it during training.`
          : window === "unknown"
            ? "No time step: treated as new, unseen data."
            : `From the ${WINDOW_TEXT[window]}, but unlabelled or not in the dataset, so it was never training data.`}
    </p>
  );
}

function ShapBars({ reasons }: { reasons: Shap[] }) {
  const max = Math.max(1e-9, ...reasons.map((s) => Math.abs(s.shap)));
  return (
    <div className="grid gap-1.5">
      {reasons.map((s) => (
        <div key={s.feature} className="grid grid-cols-[6.5rem_1fr_3.5rem] items-center gap-2 font-mono text-xs">
          <span title={`feature value ${s.value}`}>{s.feature}</span>
          <div className="relative h-2 rounded-full bg-muted">
            <div
              className="absolute top-0 h-2 rounded-full"
              style={{
                left: s.shap >= 0 ? "50%" : `${50 - (Math.abs(s.shap) / max) * 50}%`,
                width: `${(Math.abs(s.shap) / max) * 50}%`,
                background: s.shap >= 0 ? "#F2716B" : "#5FA8F5",
              }}
            />
            <div className="absolute top-[-2px] left-1/2 h-3 w-px bg-border" />
          </div>
          <span className="text-right tabular-nums">{s.shap > 0 ? "+" : ""}{s.shap.toFixed(2)}</span>
        </div>
      ))}
      <p className="pt-1 text-[11px] text-muted-foreground">XGBoost SHAP. Red pushes toward illicit, blue toward licit.</p>
    </div>
  );
}

function errText(e: unknown) {
  const err = e as ApiError;
  return err.kind === "offline" ? "Backend offline - start it with python -m uvicorn backend.main:app --port 8000" : err.message;
}

function toCsv(r: BatchScore) {
  const head = "row,tx_id,time_step,window,in_sample,label,xgb,rf,top_reason,top_reason_shap";
  const lines = r.rows.map((x) =>
    [x.row, x.tx_id ?? "", x.time_step ?? "", x.window, x.in_sample, x.label, x.xgb, x.rf ?? "", x.reasons[0]?.feature ?? "", x.reasons[0]?.shap ?? ""].join(","),
  );
  return [head, ...lines].join("\n") + "\n";
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  URL.revokeObjectURL(url);
}

export default function ScorePage() {
  const [tab, setTab] = useState("lookup");
  const [txInput, setTxInput] = useState("");
  const [tx, setTx] = useState<TxScore | null>(null);
  const [txBusy, setTxBusy] = useState(false);
  const [batch, setBatch] = useState<BatchScore | null>(null);
  const [source, setSource] = useState("");
  const [batchBusy, setBatchBusy] = useState(false);
  const [sampleLabel, setSampleLabel] = useState<SampleLabel>("illicit");
  const [sampleN, setSampleN] = useState("100");
  const [threshold, setThreshold] = useState(0.5);
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const [page, setPage] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const setFocus = useDash((s) => s.setFocus);
  const escalate = useDash((s) => s.escalate);

  async function lookup(id: number) {
    setTxBusy(true);
    try {
      setTx(await api.scoreTx(id));
    } catch (e) {
      setTx(null);
      toast.add({ title: "Could not score", description: errText(e), type: "error" });
    } finally {
      setTxBusy(false);
    }
  }

  async function scoreCsv(csv: string, from: string) {
    setBatchBusy(true);
    try {
      const r = await api.scoreCsv(csv);
      setBatch(r);
      setSource(from);
      setPage(0);
      toast.add({ title: `Scored ${fmtInt(r.n)} rows`, description: `${r.n_flagged} at or above 0.50`, type: "success" });
    } catch (e) {
      toast.add({ title: "Upload refused", description: errText(e), type: "error" });
    } finally {
      setBatchBusy(false);
    }
  }

  async function fetchSample(): Promise<string | null> {
    try {
      const res = await fetch(api.sampleUrl(Number(sampleN) || 100, sampleLabel));
      if (!res.ok) throw new ApiError("server", await res.text());
      return await res.text();
    } catch (e) {
      toast.add({ title: "Could not read sample rows", description: errText(e), type: "error" });
      return null;
    }
  }

  const rows = useMemo(() => {
    if (!batch) return [];
    return [...batch.rows].filter((r) => !onlyFlagged || r.xgb >= threshold).sort((a, b) => b.xgb - a.xgb);
  }, [batch, onlyFlagged, threshold]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const p = Math.min(page, pages - 1);
  const flaggedAt = batch ? batch.rows.filter((r) => r.xgb >= threshold).length : 0;
  const labelled = batch ? batch.rows.filter((r) => r.label !== "unknown") : [];
  const hits = labelled.filter((r) => (r.xgb >= threshold) === (r.label === "illicit")).length;

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(String(v))} className="gap-4">
      <TabsList>
        <TabsTrigger value="lookup"><Search /> Look up a transaction</TabsTrigger>
        <TabsTrigger value="batch"><FileUp /> Score a CSV</TabsTrigger>
      </TabsList>

      <TabsContent value="lookup" className="grid gap-4">
        <Card>
          <CardContent>
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const id = Number(txInput.trim());
                if (!Number.isInteger(id) || id <= 0) {
                  toast.add({ title: "Enter a numeric transaction id", type: "error" });
                  return;
                }
                void lookup(id);
              }}
            >
              <label className="grid gap-1">
                <span className="text-xs text-muted-foreground">Any of the 203,769 Elliptic transaction ids</span>
                <Input value={txInput} onChange={(e) => setTxInput(e.target.value)} placeholder="e.g. 230425980" className="w-56 font-mono text-xs" />
              </label>
              <Button type="submit" disabled={txBusy}>{txBusy ? "Scoring…" : "Score"}</Button>
            </form>
          </CardContent>
        </Card>

        {tx ? (
          <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
            <Card>
              <CardHeader>
                <CardTitle className="font-mono text-lg font-normal">tx {tx.tx_id}</CardTitle>
                <CardDescription>Time step {tx.time_step} · {tx.in_degree} inbound · {tx.out_degree} outbound flows</CardDescription>
                <div className="flex items-center gap-2 pt-1">
                  <LabelBadge label={tx.label} />
                  <span className="text-xs text-muted-foreground">ground-truth label from the dataset</span>
                </div>
              </CardHeader>
              <CardContent className="grid gap-4">
                <div className="grid grid-cols-3 gap-3">
                  <Kpi title="XGBoost" value={tx.xgb.toFixed(3)} hint={tx.xgb >= 0.5 ? "flagged" : "below 0.5"} />
                  <Kpi title="Random forest" value={fmt3(tx.rf)} />
                  <Kpi title="Hybrid" value={fmt3(tx.hybrid)} hint={tx.hybrid == null ? "test window only" : "calibrated ensemble"} />
                </div>
                <WindowNote window={tx.window} inSample={tx.in_sample} />
                <p className="text-xs text-muted-foreground">A score ranks suspicion for review. It does not establish that a transaction is criminal.</p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/dashboard/flow/" onClick={() => tx.tx_id && setFocus(tx.tx_id)} />}>
                    <Network /> Open in flow canvas
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={async () => {
                      if (!tx.tx_id) return;
                      const cid = await escalate([tx.tx_id], "new", `Scored tx ${tx.tx_id}`);
                      if (cid) toast.add({ title: `Escalated to ${cid}`, description: "See Cases", type: "warning" });
                    }}
                  >
                    Escalate to a new case
                  </Button>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="font-normal">Why the model scored it this way</CardTitle>
                <CardDescription>Ten largest feature contributions</CardDescription>
              </CardHeader>
              <CardContent>
                <ShapBars reasons={tx.reasons} />
              </CardContent>
            </Card>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Score any transaction with the trained XGBoost and random-forest models and see the SHAP reasons behind it.</p>
        )}
      </TabsContent>

      <TabsContent value="batch" className="grid gap-4">
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="font-normal">Upload transactions</CardTitle>
              <CardDescription>
                Elliptic layout without a header (txId, time step, 165 features), or a header naming local_1…local_93 and agg_1…agg_72. Up to 5,000 rows.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (f) await scoreCsv(await f.text(), f.name);
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                className="grid w-full place-items-center gap-2 rounded-xl border border-dashed p-8 text-sm text-muted-foreground transition-colors hover:border-ring hover:text-foreground"
                onClick={() => fileRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={async (e) => {
                  e.preventDefault();
                  const f = e.dataTransfer.files?.[0];
                  if (f) await scoreCsv(await f.text(), f.name);
                }}
              >
                <FileUp className="size-6" />
                {batchBusy ? "Scoring…" : "Drop a CSV here or click to choose a file"}
              </button>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="font-normal">No file? Use real rows</CardTitle>
              <CardDescription>Random transactions from the held-out test window of the dataset, with their true labels.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-end gap-2">
              <Select value={sampleLabel} onValueChange={(v) => setSampleLabel(v as SampleLabel)} items={[...SAMPLE_LABELS]}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>{SAMPLE_LABELS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
              </Select>
              <Input value={sampleN} onChange={(e) => setSampleN(e.target.value.replace(/\D/g, ""))} className="w-20 font-mono text-xs" aria-label="Number of rows" />
              <Button
                disabled={batchBusy}
                onClick={async () => {
                  const csv = await fetchSample();
                  if (csv) await scoreCsv(csv, `${sampleN} random ${sampleLabel} test-window rows`);
                }}
              >
                <Sparkles /> Score them
              </Button>
              <Button
                variant="outline"
                onClick={async () => {
                  const csv = await fetchSample();
                  if (csv) download(`elliptic_sample_${sampleLabel}_${sampleN}.csv`, csv);
                }}
              >
                <Download /> Download CSV
              </Button>
            </CardContent>
          </Card>
        </div>

        {batch ? (
          <>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <Kpi title="Rows scored" value={fmtInt(batch.n)} hint={source} />
              <Kpi title={`Flagged ≥ ${threshold.toFixed(2)}`} value={fmtInt(flaggedAt)} hint={`${batch.n ? ((flaggedAt / batch.n) * 100).toFixed(1) : 0}% of rows`} />
              <Kpi
                title="Agrees with labels"
                value={labelled.length ? `${((hits / labelled.length) * 100).toFixed(1)}%` : "–"}
                hint={labelled.length ? `${hits} of ${labelled.length} labelled rows` : "no labelled rows"}
              />
              <Kpi title="In-sample rows" value={fmtInt(batch.n_in_sample)} hint="labelled, steps 1–34: optimistic" />
            </div>
            <Card>
              <CardContent className="flex flex-wrap items-center gap-4">
                <label className="grid gap-1">
                  <span className="text-xs text-muted-foreground">Flag threshold {threshold.toFixed(2)}</span>
                  <input type="range" min={0.05} max={0.95} step={0.05} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} className="h-8 w-48" />
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={onlyFlagged} onChange={(e) => { setOnlyFlagged(e.target.checked); setPage(0); }} /> Only flagged rows
                </label>
                <Button variant="outline" size="sm" className="ml-auto" onClick={() => download("chainsleuth_scores.csv", toCsv(batch))}>
                  <Download /> Download results
                </Button>
              </CardContent>
            </Card>
            <Card className="py-0">
              <CardContent className="overflow-x-auto px-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-4">Row</TableHead>
                      <TableHead>Transaction</TableHead>
                      <TableHead>Step</TableHead>
                      <TableHead>True label</TableHead>
                      <TableHead>XGBoost</TableHead>
                      <TableHead>RF</TableHead>
                      <TableHead className="pr-4">Top reason</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.slice(p * PAGE, p * PAGE + PAGE).map((r) => (
                      <TableRow
                        key={r.row}
                        className={cn(r.tx_id && "cursor-pointer")}
                        onClick={() => {
                          if (!r.tx_id) return;
                          setTxInput(String(r.tx_id));
                          setTab("lookup");
                          void lookup(r.tx_id);
                        }}
                      >
                        <TableCell className="pl-4 font-mono text-xs text-muted-foreground">{r.row}</TableCell>
                        <TableCell className="font-mono">{r.tx_id ?? "–"}</TableCell>
                        <TableCell className={cn("font-mono", r.in_sample && "text-warning")} title={r.in_sample ? "in-sample step" : undefined}>
                          {r.time_step != null ? `t${r.time_step}` : "–"}
                        </TableCell>
                        <TableCell><LabelBadge label={r.label} /></TableCell>
                        <TableCell><ScoreBar value={r.xgb} /></TableCell>
                        <TableCell className="font-mono text-xs">{fmt3(r.rf)}</TableCell>
                        <TableCell className="pr-4 font-mono text-xs">
                          {r.reasons[0] ? `${r.reasons[0].feature} ${r.reasons[0].shap > 0 ? "+" : ""}${r.reasons[0].shap.toFixed(2)}` : "–"}
                        </TableCell>
                      </TableRow>
                    ))}
                    {!rows.length ? (
                      <TableRow>
                        <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">No rows at or above this threshold.</TableCell>
                      </TableRow>
                    ) : null}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
            <div className="flex items-center justify-end gap-2 text-sm">
              <span className="text-muted-foreground">Page {p + 1} of {pages}</span>
              <Button size="sm" variant="outline" disabled={p === 0} onClick={() => setPage(p - 1)}>Previous</Button>
              <Button size="sm" variant="outline" disabled={p >= pages - 1} onClick={() => setPage(p + 1)}>Next</Button>
            </div>
          </>
        ) : null}
      </TabsContent>
    </Tabs>
  );
}
