"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertSheet } from "@/components/dash/alert-sheet";
import { Kpi, LabelBadge, ScoreBar, StatusBadge } from "@/components/dash/bits";
import { inQueue, useDash } from "@/lib/dash/store";
import { fmtInt, fmtTime } from "@/lib/dash/format";

const cfg = {
  illicit: { label: "Illicit", color: "#F2716B" },
  unknown: { label: "Unknown", color: "#8B90A6" },
  licit: { label: "Licit", color: "#5FA8F5" },
} satisfies ChartConfig;

const TONE = { info: "bg-info", warn: "bg-warning", ok: "bg-success", bad: "bg-destructive" } as const;

export default function Overview() {
  const alerts = useDash((s) => s.alerts);
  const activity = useDash((s) => s.activity);
  const cases = useDash((s) => s.cases);
  const threshold = useDash((s) => s.settings.threshold);
  const win = useDash((s) => s.window);
  const [open, setOpen] = useState<number | null>(null);

  const q = useMemo(() => inQueue(alerts, threshold), [alerts, threshold]);
  const byStep = useMemo(() => {
    const rows = Array.from({ length: 15 }, (_, i) => ({ step: `t${35 + i}`, illicit: 0, unknown: 0, licit: 0 }));
    q.forEach((a) => (rows[a.step - 35][a.label] += 1));
    return rows;
  }, [q]);
  const count = (s: string) => q.filter((a) => a.status === s).length;
  const top = q.filter((a) => a.status === "new" || a.status === "reviewing").slice(0, 8);

  return (
    <>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi title="In queue" value={q.length} hint={`score ≥ ${threshold.toFixed(2)} · of ${win ? fmtInt(win.n_scored) : "–"} scored`} />
        <Kpi title="Unreviewed" value={count("new")} hint={`${count("reviewing")} in review`} />
        <Kpi title="Escalated" value={count("escalated")} hint={`${cases.filter((c) => c.status !== "closed").length} open cases`} />
        <Kpi title="Cleared" value={count("cleared")} hint="false positives" />
      </div>

      <div className="grid gap-4 xl:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="font-normal">Flagged per time step</CardTitle>
            <CardDescription>Queue alerts in the test window (steps 35–49), by label</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={cfg} className="h-64 w-full">
              <BarChart data={byStep}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="step" tickLine={false} axisLine={false} />
                <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={28} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <ChartLegend content={<ChartLegendContent />} />
                <Bar dataKey="illicit" stackId="a" fill="var(--color-illicit)" />
                <Bar dataKey="unknown" stackId="a" fill="var(--color-unknown)" />
                <Bar dataKey="licit" stackId="a" fill="var(--color-licit)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="font-normal">Recent activity</CardTitle>
            <CardDescription>Latest analyst actions, saved by the backend</CardDescription>
          </CardHeader>
          <CardContent>
            {!activity.length ? <p className="text-sm text-muted-foreground">Nothing yet. Assign, clear or escalate an alert and it shows up here.</p> : null}
            <ul className="grid gap-3">
              {activity.slice(0, 7).map((a, i) => (
                <li key={i} className="flex gap-3 text-sm">
                  <span className={`mt-1.5 size-2 shrink-0 rounded-full ${TONE[a.tone]}`} />
                  <div className="min-w-0">
                    <p className="truncate">
                      <span className="text-muted-foreground">{a.who}</span> {a.text}
                    </p>
                    <p className="text-[11px] text-muted-foreground">{fmtTime(a.at)}</p>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="font-normal">Highest suspicion, not yet decided</CardTitle>
            <CardDescription>Open one to see its scores, SHAP reasons and actions</CardDescription>
          </div>
          <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/dashboard/alerts/" />}>
            Full queue
          </Button>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Transaction</TableHead>
                <TableHead>Step</TableHead>
                <TableHead>Label</TableHead>
                <TableHead>Hybrid score</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Flows in/out</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {top.map((a) => (
                <TableRow key={a.id} className="cursor-pointer" onClick={() => setOpen(a.id)}>
                  <TableCell className="font-mono">{a.id}</TableCell>
                  <TableCell className="font-mono">t{a.step}</TableCell>
                  <TableCell><LabelBadge label={a.label} /></TableCell>
                  <TableCell><ScoreBar value={a.hybrid} /></TableCell>
                  <TableCell><StatusBadge status={a.status} /></TableCell>
                  <TableCell className="text-right font-mono text-xs text-muted-foreground">{a.inDeg} / {a.outDeg}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <AlertSheet id={open} onClose={() => setOpen(null)} />
    </>
  );
}
