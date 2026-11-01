"use client";

import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import type { Contribution } from "@/lib/api";

export function ScoreBars({ scores }: { scores: Record<string, number> }) {
  const data = Object.entries(scores)
    .map(([name, v]) => ({ name, value: Math.max(0, Math.min(1, v)) }))
    .sort((a, b) => b.value - a.value);
  return (
    <ResponsiveContainer width="100%" height={data.length * 34 + 20}>
      <BarChart data={data} layout="vertical" margin={{ left: 90, right: 20 }}>
        <XAxis type="number" domain={[0, 1]} tick={{ fill: "#71717a", fontSize: 11 }} />
        <YAxis
          type="category" dataKey="name" width={85}
          tick={{ fill: "#a1a1aa", fontSize: 11, fontFamily: "monospace" }}
        />
        <Tooltip
          contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", fontSize: 12 }}
          formatter={(v) => [Number(v).toFixed(4), "score"]}
        />
        <Bar dataKey="value" fill="#e4e4e7" barSize={14} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function ShapChart({ items }: { items: Contribution[] }) {
  const data = [...items].sort(
    (a, b) => Math.abs(b.shap) - Math.abs(a.shap)
  );
  return (
    <ResponsiveContainer width="100%" height={data.length * 30 + 20}>
      <BarChart data={data} layout="vertical" margin={{ left: 90, right: 20 }}>
        <XAxis type="number" tick={{ fill: "#71717a", fontSize: 11 }} />
        <YAxis
          type="category" dataKey="feature" width={85}
          tick={{ fill: "#a1a1aa", fontSize: 11, fontFamily: "monospace" }}
        />
        <Tooltip
          contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", fontSize: 12 }}
          formatter={(v, _n, item) => [
            `${Number(v).toFixed(3)} (value ${Number((item as { payload?: Contribution }).payload?.value ?? 0).toFixed(2)})`,
            "shap",
          ]}
        />
        <Bar dataKey="shap" barSize={14}>
          {data.map((d) => (
            <Cell key={d.feature} fill={d.shap > 0 ? "#ef4444" : "#38bdf8"} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
