"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useEffect } from "react";
import type { GraphData } from "@/lib/api";

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), {
  ssr: false,
});

// label -> [border/text color, chip background]
const CHIP: Record<string, [string, string]> = {
  illicit: ["#f87171", "rgba(127,29,29,0.55)"],
  licit: ["#38bdf8", "rgba(12,74,110,0.55)"],
  unknown: ["#a1a1aa", "rgba(39,39,42,0.7)"],
};
const ACCENT = "#f59e0b";
const ACCENT_BG = "rgba(120,53,15,0.75)";
const BG = "#070b14";

type FgNode = {
  id: number;
  label: string;
  is_center: boolean;
  hop: number;
  degree: number;
  score: number | null;
  x?: number;
  y?: number;
  fx?: number;
  fy?: number;
};

function shortId(id: number) {
  const s = String(id);
  return s.length > 9 ? `${s.slice(0, 4)}…${s.slice(-4)}` : s;
}

function chip(ctx: CanvasRenderingContext2D, x: number, y: number,
              w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - h / 2, w, h, r);
}

export default function NetworkGraph({ data }: { data: GraphData }) {
  const router = useRouter();
  const wrap = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 900, h: 560 });
  const [hoverId, setHoverId] = useState<number | null>(null);

  useEffect(() => {
    if (!wrap.current) return;
    const ro = new ResizeObserver((e) =>
      setSize({ w: e[0].contentRect.width, h: e[0].contentRect.height })
    );
    ro.observe(wrap.current);
    return () => ro.disconnect();
  }, []);

  const w = size.w;

  // layered layout: x = signed hop (preds left, succs right), y = stack order
  const laid = useMemo(() => {
    const cols = new Map<number, FgNode[]>();
    const nodes: FgNode[] = data.nodes.map((n) => ({ ...n }));
    for (const n of nodes) {
      const c = cols.get(n.hop) ?? [];
      c.push(n);
      cols.set(n.hop, c);
    }
    const hops = [...cols.keys()];
    const minHop = Math.min(...hops), maxHop = Math.max(...hops);
    const span = Math.max(1, maxHop - minHop);
    const colW = Math.max(280, (w - 200) / Math.max(1, span));
    for (const [hop, col] of cols) {
      const rowH = Math.min(80, (size.h - 80) / Math.max(1, col.length - 1 || 1));
      col.forEach((n, i) => {
        n.fx = (hop - (minHop + span / 2)) * colW;
        n.fy = (i - (col.length - 1) / 2) * rowH;
      });
    }
    return { nodes, links: data.links };
  }, [data, w, size.h]);

  const linked = useMemo(() => {
    const m = new Map<number, Set<number>>();
    for (const l of data.links) {
      const s = typeof l.source === "number" ? l.source : (l.source as { id: number }).id;
      const t = typeof l.target === "number" ? l.target : (l.target as { id: number }).id;
      m.get(s)?.add(t) ?? m.set(s, new Set([t]));
      m.get(t)?.add(s) ?? m.set(t, new Set([s]));
    }
    return m;
  }, [data.links]);

  const dim = (id: number) =>
    hoverId != null && id !== hoverId && !linked.get(hoverId)?.has(id);

  return (
    <div ref={wrap} className="absolute inset-0" style={{ background: BG }}>
      <ForceGraph2D
        graphData={laid as never}
        width={size.w}
        height={Math.max(400, size.h)}
        backgroundColor={BG}
        cooldownTicks={0}
        nodeRelSize={4}
        nodeCanvasObject={(node: object, ctx: CanvasRenderingContext2D, scale: number) => {
          const n = node as FgNode;
          const dimmed = dim(n.id);
          ctx.globalAlpha = dimmed ? 0.12 : 1;

          const [line, bg] = n.is_center ? [ACCENT, ACCENT_BG] : CHIP[n.label] ?? CHIP.unknown;
          const fs = 11 / Math.pow(scale, 0.35);
          ctx.font = `${n.is_center ? "600 " : ""}${fs}px "JetBrains Mono", monospace`;
          const text = n.is_center ? String(n.id) : shortId(n.id);
          const tw = ctx.measureText(text).width;
          const padX = n.is_center ? 14 : 10;
          const chipW = tw + padX * 2;
          const chipH = n.is_center ? 24 : 20;

          chip(ctx, n.x ?? 0, n.y ?? 0, chipW, chipH, 6);
          ctx.fillStyle = bg;
          ctx.fill();
          ctx.strokeStyle = line;
          ctx.lineWidth = n.is_center ? 1.8 : 1;
          ctx.stroke();

          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillStyle = n.is_center ? "#fde68a" : line;
          ctx.fillText(text, n.x ?? 0, (n.y ?? 0) + 0.5);

          // suspicion tag for high-scoring unlabeled nodes
          if (!n.is_center && n.score != null && n.score > 0.5) {
            const tagFs = fs * 0.75;
            ctx.font = `${tagFs}px monospace`;
            ctx.fillStyle = "#f59e0b";
            ctx.fillText(n.score.toFixed(2), n.x ?? 0, (n.y ?? 0) + chipH / 2 + tagFs);
          }
          ctx.globalAlpha = 1;
        }}
        nodeLabel={(node: object) => {
          const n = node as FgNode;
          return `tx ${n.id} | ${n.label}${n.score != null ? ` | score ${n.score.toFixed(3)}` : ""} | deg ${n.degree}`;
        }}
        linkCurvature={0.18}
        linkColor={(l: object) => {
          const link = l as { source: FgNode; target: FgNode };
          if (
            hoverId != null &&
            link.source.id !== hoverId &&
            link.target.id !== hoverId
          )
            return "rgba(63,63,70,0.1)";
          const hot =
            link.source.label === "illicit" || link.target.label === "illicit";
          return hot ? "rgba(239,68,68,0.4)" : "rgba(120,144,180,0.32)";
        }}
        linkWidth={(l: object) => {
          const link = l as { source: FgNode; target: FgNode };
          return hoverId != null &&
            (link.source.id === hoverId || link.target.id === hoverId)
            ? 1.4
            : 0.7;
        }}
        linkDirectionalArrowLength={4}
        linkDirectionalArrowRelPos={0.82}
        linkDirectionalArrowColor={(l: object) => {
          const link = l as { source: FgNode; target: FgNode };
          return link.source.label === "illicit" || link.target.label === "illicit"
            ? "rgba(239,68,68,0.7)"
            : "rgba(148,163,184,0.55)";
        }}
        linkDirectionalParticles={1}
        linkDirectionalParticleWidth={1.8}
        linkDirectionalParticleSpeed={0.006}
        linkDirectionalParticleColor={() => "rgba(245,158,11,0.8)"}
        onNodeHover={(n: object | null) => setHoverId(n ? (n as FgNode).id : null)}
        onNodeClick={(n: object) => router.push(`/tx/${(n as FgNode).id}`)}
      />
    </div>
  );
}
