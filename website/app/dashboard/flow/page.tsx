"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { AlertSheet } from "@/components/dash/alert-sheet";
import { LABEL_COLOR, LabelBadge, ScoreBar } from "@/components/dash/bits";
import { neighbourhood, type GraphNode } from "@/lib/dash/mock";
import { useDash } from "@/lib/dash/store";

const COL = 210;
const ROW = 64;
const NW = 150;
const NH = 40;

export default function FlowPage() {
  const alerts = useDash((s) => s.alerts);
  const focus = useDash((s) => s.focus);
  const setFocus = useDash((s) => s.setFocus);
  const [hops, setHops] = useState<1 | 2>(1);
  const [jump, setJump] = useState("");
  const [sheet, setSheet] = useState<number | null>(null);
  const known = useMemo(() => new Map(alerts.map((a) => [a.id, a])), [alerts]);
  const center = focus ?? alerts[0]?.id;
  const [picked, setPicked] = useState<number | null>(null);

  const { nodes, edges, pos, width, height } = useMemo(() => {
    const g = neighbourhood(center, hops, known);
    const cols = new Map<number, GraphNode[]>();
    g.nodes.forEach((n) => cols.set(n.hop, [...(cols.get(n.hop) ?? []), n]));
    const minHop = -hops;
    const maxRows = Math.max(...[...cols.values()].map((c) => c.length), 1);
    const height = Math.max(280, maxRows * ROW + 40);
    const pos = new Map<number, { x: number; y: number }>();
    cols.forEach((list, hop) => {
      const top = (height - list.length * ROW) / 2 + ROW / 2;
      list.forEach((n, i) => pos.set(n.id, { x: 20 + (hop - minHop) * COL, y: top + i * ROW }));
    });
    return { ...g, pos, width: 40 + hops * 2 * COL + NW, height };
  }, [center, hops, known]);

  const sel = nodes.find((n) => n.id === (picked ?? center)) ?? nodes[0];
  const selAlert = sel ? known.get(sel.id) : undefined;
  const pivot = (id: number) => {
    setFocus(id);
    setPicked(null);
  };

  return (
    <>
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3">
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const id = Number(jump.trim());
              if (!Number.isFinite(id) || id <= 0) {
                toast.add({ title: "Enter a numeric transaction id", type: "error" });
                return;
              }
              pivot(id);
              setJump("");
            }}
          >
            <label className="grid gap-1">
              <span className="text-xs text-muted-foreground">Center on transaction</span>
              <Input value={jump} onChange={(e) => setJump(e.target.value)} placeholder={String(center)} className="w-44 font-mono text-xs" />
            </label>
            <Button type="submit" variant="secondary">Go</Button>
          </form>
          <div className="flex gap-1">
            {[1, 2].map((h) => (
              <Button key={h} size="sm" variant={hops === h ? "default" : "outline"} onClick={() => setHops(h as 1 | 2)}>
                {h} hop{h === 2 ? "s" : ""}
              </Button>
            ))}
          </div>
          <div className="ml-auto flex flex-wrap gap-3 text-xs text-muted-foreground">
            {(["illicit", "unknown", "licit"] as const).map((l) => (
              <span key={l} className="inline-flex items-center gap-1.5">
                <span className="size-2 rounded-full" style={{ background: LABEL_COLOR[l] }} /> {l}
              </span>
            ))}
            <span>funds flow left → right</span>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[1fr_20rem]">
        <Card className="overflow-hidden py-0">
          <div className="overflow-x-auto">
            <svg width={width} height={height} className="block min-w-full" role="img" aria-label={`Flow neighbourhood of transaction ${center}`}>
              <defs>
                <pattern id="dots" width="16" height="16" patternUnits="userSpaceOnUse">
                  <circle cx="1" cy="1" r="1" fill="#20232e" />
                </pattern>
                <marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
                  <path d="M0 0 L8 4 L0 8 z" fill="#3c414f" />
                </marker>
              </defs>
              <rect width="100%" height="100%" fill="url(#dots)" />
              {edges.map((e, i) => {
                const a = pos.get(e.from)!;
                const b = pos.get(e.to)!;
                const x1 = a.x + NW, x2 = b.x - 2, mx = (x1 + x2) / 2;
                return <path key={i} d={`M${x1} ${a.y} C${mx} ${a.y} ${mx} ${b.y} ${x2} ${b.y}`} fill="none" stroke="#3c414f" strokeWidth="1.2" markerEnd="url(#arrow)" />;
              })}
              {nodes.map((n) => {
                const p = pos.get(n.id)!;
                const isCenter = n.id === center;
                const isSel = n.id === sel?.id;
                return (
                  <g
                    key={n.id}
                    transform={`translate(${p.x} ${p.y - NH / 2})`}
                    className="cursor-pointer"
                    onClick={() => setPicked(n.id)}
                    onDoubleClick={() => pivot(n.id)}
                  >
                    <rect width={NW} height={NH} rx="10" fill={isCenter ? "#20232e" : "#10111a"} stroke={isSel ? "#ffffff" : LABEL_COLOR[n.label]} strokeOpacity={isSel ? 0.9 : 0.5} />
                    <circle cx="16" cy={NH / 2} r="5" fill={LABEL_COLOR[n.label]} />
                    <text x="28" y="17" fill="#ffffff" fontSize="12" fontFamily="plexMono, monospace">{n.id}</text>
                    <text x="28" y="31" fill="#8f95a8" fontSize="10" fontFamily="plexMono, monospace">
                      {n.score == null ? "not scored" : `score ${n.score.toFixed(3)}`}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="font-mono text-base font-normal">tx {sel?.id}</CardTitle>
            <CardDescription>
              {sel?.hop === 0 ? "Center" : sel && sel.hop < 0 ? `${-sel.hop} hop${sel.hop === -1 ? "" : "s"} upstream` : `${sel?.hop} hop${sel?.hop === 1 ? "" : "s"} downstream`}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {sel ? <LabelBadge label={sel.label} className="justify-self-start" /> : null}
            <ScoreBar value={sel?.score ?? null} />
            <p className="text-sm text-muted-foreground">
              {nodes.length - 1} neighbours shown · {edges.length} flows. Click a node to inspect it, double-click to re-center.
            </p>
            <div className="flex flex-wrap gap-2">
              {sel && sel.id !== center ? <Button size="sm" variant="secondary" onClick={() => pivot(sel.id)}>Center here</Button> : null}
              {selAlert ? (
                <Button size="sm" onClick={() => setSheet(selAlert.id)}>Open alert</Button>
              ) : (
                <span className="text-xs text-muted-foreground">Not in the alert queue.</span>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
      <AlertSheet id={sheet} onClose={() => setSheet(null)} />
    </>
  );
}
