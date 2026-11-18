"use client";

import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Kpi } from "@/components/dash/bits";
import { MODELS, WEIGHTS } from "@/lib/dash/real";
import { cn } from "@/lib/utils";

type Model = (typeof MODELS)[number];
type Metric = "ap" | "f1" | "auc" | "p" | "r" | "p100";

const FAMILIES = ["all", "tabular", "anomaly", "graph", "ensemble", "experiment"] as const;
const METRICS: { key: Metric; label: string }[] = [
  { key: "ap", label: "AP (PR-AUC)" },
  { key: "f1", label: "F1" },
  { key: "auc", label: "ROC-AUC" },
  { key: "p", label: "Precision" },
  { key: "r", label: "Recall" },
  { key: "p100", label: "P@100" },
];
const cfg = {
  ap: { label: "AP", color: "#f2716b" },
  f1: { label: "F1", color: "#5fa8f5" },
} satisfies ChartConfig;

/** Leakage demo: shuffles the time steps, so it is never a fair comparison point. */
const OPTIMISTIC = new Set(["xgboost_random_split"]);

export default function ModelsPage() {
  const [family, setFamily] = useState<(typeof FAMILIES)[number]>("all");
  const [sortKey, setSortKey] = useState<Metric>("ap");

  const rows = useMemo(
    () => MODELS.filter((m) => family === "all" || m.family === family).sort((a, b) => b[sortKey] - a[sortKey]),
    [family, sortKey],
  );
  const fair = MODELS.filter((m) => !OPTIMISTIC.has(m.key));
  const best = (k: Metric) => fair.reduce((a, b) => (b[k] > a[k] ? b : a));
  const bestAp = best("ap");
  const bestF1 = best("f1");
  const xgb = MODELS.find((m) => m.key === "xgboost");
  const rand = MODELS.find((m) => m.key === "xgboost_random_split");
  const chart = rows.map((m: Model) => ({ name: m.short, ap: +m.ap.toFixed(3), f1: +m.f1.toFixed(3) }));

  return (
    <>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi title="Best AP" value={bestAp.ap.toFixed(3)} hint={bestAp.name} />
        <Kpi title="Best F1" value={bestF1.f1.toFixed(3)} hint={bestF1.name} />
        <Kpi title="Test window" value={xgb ? xgb.nEval.toLocaleString("en-US") : "–"} hint={xgb ? `${xgb.nPos.toLocaleString("en-US")} labelled illicit, steps 35–49` : undefined} />
        <Kpi
          title="Random-split optimism"
          value={xgb && rand ? `+${((rand.ap - xgb.ap) * 100).toFixed(1)} pts` : "–"}
          hint="AP gained by leaking future steps into training"
        />
      </div>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="font-normal">Test-window ranking quality</CardTitle>
            <CardDescription>Every model trained on steps 1–34 and scored once on 35–49</CardDescription>
          </div>
          <Tabs value={family} onValueChange={(v) => setFamily(v as (typeof FAMILIES)[number])}>
            <TabsList>
              {FAMILIES.map((f) => (
                <TabsTrigger key={f} value={f} className="capitalize">{f}</TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </CardHeader>
        <CardContent>
          <ChartContainer config={cfg} className="h-64 w-full">
            <BarChart data={chart}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="name" tickLine={false} axisLine={false} interval={0} fontSize={11} />
              <YAxis domain={[0, 1]} tickLine={false} axisLine={false} width={32} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <ChartLegend content={<ChartLegendContent />} />
              <Bar dataKey="ap" fill="var(--color-ap)" radius={[3, 3, 0, 0]} />
              <Bar dataKey="f1" fill="var(--color-f1)" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ChartContainer>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[2fr_1fr]">
        <Card className="py-0">
          <CardContent className="overflow-x-auto px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Model</TableHead>
                  <TableHead>Family</TableHead>
                  {METRICS.map((m) => (
                    <TableHead key={m.key} className="text-right">
                      <button className={cn("hover:text-foreground", sortKey === m.key && "text-foreground underline")} onClick={() => setSortKey(m.key)}>
                        {m.label}
                      </button>
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((m) => (
                  <TableRow key={m.key} className={OPTIMISTIC.has(m.key) ? "text-muted-foreground" : undefined}>
                    <TableCell className="pl-4">
                      {m.name}
                      {OPTIMISTIC.has(m.key) ? <span className="ml-2 font-mono text-[10px] text-warning">leaky split</span> : null}
                    </TableCell>
                    <TableCell className="font-mono text-xs capitalize text-muted-foreground">{m.family}</TableCell>
                    {METRICS.map((k) => (
                      <TableCell key={k.key} className={cn("text-right font-mono text-xs tabular-nums", !OPTIMISTIC.has(m.key) && best(k.key).key === m.key && "text-chart-3")}>
                        {m[k.key].toFixed(3)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="font-normal">Ensemble weights</CardTitle>
            <CardDescription>Tuned on validation steps 30–34, frozen before the test window</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {WEIGHTS ? (
              WEIGHTS.map((w) => (
                <div key={w.name} className="grid grid-cols-[8rem_1fr_3rem] items-center gap-2 text-sm">
                  <span className="text-muted-foreground">{w.name}</span>
                  <div className="h-1.5 rounded-full bg-muted">
                    <div className="h-1.5 rounded-full bg-chart-3" style={{ width: `${w.weight * 100}%` }} />
                  </div>
                  <span className="text-right font-mono text-xs tabular-nums">{w.weight.toFixed(2)}</span>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">
                Not recorded yet. Run <code className="font-mono text-xs">python -m experiments.hybrid</code>, then{" "}
                <code className="font-mono text-xs">python -m experiments.export_site_data</code>.
              </p>
            )}
            <p className="pt-2 text-xs text-muted-foreground">
              Scores are suspicion rankings for analyst review. A high score does not establish that a transaction is criminal.
            </p>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
