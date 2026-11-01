"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useEffect } from "react";
import type { GraphData } from "@/lib/api";

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), {
  ssr: false,
});

const COLORS: Record<string, string> = {
  illicit: "#ef4444",
  licit: "#38bdf8",
  unknown: "#71717a",
};
const ACCENT = "#f59e0b";
const BG = "#060a12";

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
  return s.length > 7 ? `…${s.slice(-7)}` : s;
}

export default function NetworkGraph({ data }: { data: GraphData }) {
  const router = useRouter();
  const wrap = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(900);
  const [hoverId, setHoverId] = useState<number | null>(null);

  useEffect(() => {
    if (!wrap.current) return;
    const ro = new ResizeObserver((e) => setW(e[0].contentRect.width));
    ro.observe(wrap.current);
    return () => ro.disconnect();
  }, []);

  // deterministic layered layout: x = signed hop, y = column stack order
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
    const colW = Math.max(220, (w - 160) / Math.max(1, span));
    for (const [hop, col] of cols) {
      const rowH = Math.min(90, 480 / Math.max(1, col.length - 1 || 1));
      col.forEach((n, i) => {
        n.fx = (hop - (minHop + span / 2)) * colW;
        n.fy = (i - (col.length - 1) / 2) * rowH;
      });
    }
    return { nodes, links: data.links };
  }, [data, w]);

  const linked = useMemo(() => {
    const m = new Map<number, Set<number>>();
    for (const l of data.links) {
      const s = typeof l.source === "number" ? l.source : (l.source as unknown as { id: number }).id;
      const t = typeof l.target === "number" ? l.target : (l.target as unknown as { id: number }).id;
      (m.get(s) ?? m.set(s, new Set()).get(s)!).add(t);
      (m.get(t) ?? m.set(t, new Set()).get(t)!).add(s);
    }
    return m;
  }, [data.links]);

  const dim = (id: number) =>
    hoverId != null && id !== hoverId && !linked.get(hoverId)?.has(id);

  return (
    <div ref={wrap} className="border border-zinc-800" style={{ background: BG }}>
      <ForceGraph2D
        graphData={laid as never}
        width={w}
        height={560}
        backgroundColor={BG}
        cooldownTicks={0}
        nodeCanvasObject={(node: object, ctx: CanvasRenderingContext2D, scale: number) => {
          const n = node as FgNode;
          const dimmed = dim(n.id);
          const r = n.is_center ? 9 : 4.5 + Math.min(3, Math.log2(1 + n.degree));
          ctx.globalAlpha = dimmed ? 0.15 : 1;
          ctx.beginPath();
          ctx.arc(n.x ?? 0, n.y ?? 0, r, 0, Math.PI * 2);
          ctx.fillStyle = n.is_center ? ACCENT : BG;
          ctx.fill();
          ctx.strokeStyle = n.is_center ? ACCENT : COLORS[n.label] ?? "#71717a";
          ctx.lineWidth = n.is_center ? 2 : 1.4;
          ctx.stroke();

          if (scale > 0.8 || n.is_center) {
            const fs = (n.is_center ? 4.5 : 3.5) / Math.sqrt(scale);
            ctx.font = `${n.is_center ? "600 " : ""}${fs}px monospace`;
            ctx.textAlign = "center";
            ctx.fillStyle = n.is_center ? "#fbbf24" : dimmed ? "#3f3f46" : "#a1a1aa";
            ctx.fillText(n.is_center ? String(n.id) : shortId(n.id), n.x ?? 0, (n.y ?? 0) + r + fs + 2);
            if (!n.is_center && n.score != null && n.score > 0.5 && scale > 1.2) {
              ctx.fillStyle = "#f59e0b";
              ctx.fillText(n.score.toFixed(2), n.x ?? 0, (n.y ?? 0) + r + 2 * fs + 4);
            }
          }
          ctx.globalAlpha = 1;
        }}
        nodeLabel={(node: object) => {
          const n = node as FgNode;
          return `tx ${n.id} | ${n.label}${n.score != null ? ` | score ${n.score.toFixed(3)}` : ""} | deg ${n.degree}`;
        }}
        linkColor={(l: object) => {
          const link = l as { source: FgNode; target: FgNode };
          const hot =
            link.source.label === "illicit" || link.target.label === "illicit";
          return hoverId != null &&
            link.source.id !== hoverId &&
            link.target.id !== hoverId
            ? "rgba(63,63,70,0.12)"
            : hot
              ? "rgba(239,68,68,0.4)"
              : "rgba(113,113,122,0.35)";
        }}
        linkWidth={(l: object) => {
          const link = l as { source: FgNode; target: FgNode };
          return hoverId != null &&
            (link.source.id === hoverId || link.target.id === hoverId)
            ? 1.6
            : 0.7;
        }}
        linkDirectionalArrowLength={4}
        linkDirectionalArrowRelPos={0.85}
        linkDirectionalArrowColor={(l: object) => {
          const link = l as { source: FgNode; target: FgNode };
          return link.source.label === "illicit" || link.target.label === "illicit"
            ? "rgba(239,68,68,0.7)"
            : "rgba(161,161,170,0.6)";
        }}
        linkDirectionalParticles={1}
        linkDirectionalParticleWidth={1.6}
        linkDirectionalParticleSpeed={0.005}
        linkDirectionalParticleColor={() => "rgba(245,158,11,0.7)"}
        onNodeHover={(n: object | null) => setHoverId(n ? (n as FgNode).id : null)}
        onNodeClick={(n: object) => router.push(`/tx/${(n as FgNode).id}`)}
      />
    </div>
  );
}
