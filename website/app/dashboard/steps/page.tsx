"use client";

import { Area, AreaChart, CartesianGrid, Line, LineChart, ReferenceArea, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Kpi } from "@/components/dash/bits";
import { EDA, PER_STEP } from "@/lib/dash/real";

const cfg = {
  total: { label: "Transactions", color: "#8884d8" },
  labelled: { label: "Labelled", color: "#ffc658" },
  illicit: { label: "Illicit", color: "#f2716b" },
} satisfies ChartConfig;
const shareCfg = { share: { label: "Illicit share of labelled", color: "#f2716b" } } satisfies ChartConfig;

const BANDS = [
  { from: 1, to: 29.5, label: "train", fill: "#5fa8f5" },
  { from: 29.5, to: 34.5, label: "validate", fill: "#ffc658" },
  { from: 34.5, to: 49, label: "test", fill: "#82ca9d" },
];

export default function StepsPage() {
  const share = PER_STEP.map((s) => ({ step: s.step, share: s.labelled ? +((s.illicit / s.labelled) * 100).toFixed(2) : 0 }));
  return (
    <>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi title="Transactions" value={EDA.n_total.toLocaleString("en-US")} hint={`${EDA.n_time_steps} time steps`} />
        <Kpi title="Flows" value={EDA.n_edges.toLocaleString("en-US")} hint="directed edges" />
        <Kpi title="Labelled illicit" value={EDA.n_illicit.toLocaleString("en-US")} hint={`${EDA.n_licit.toLocaleString("en-US")} licit`} />
        <Kpi title="Unknown" value={`${((EDA.n_unknown / EDA.n_total) * 100).toFixed(0)}%`} hint="never treated as licit" />
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="font-normal">Transactions per time step</CardTitle>
          <CardDescription>Bands show the split: train 1–29, validate 30–34, test 35–49</CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer config={cfg} className="h-72 w-full">
            <AreaChart data={PER_STEP}>
              {BANDS.map((b) => (
                <ReferenceArea key={b.label} x1={b.from} x2={b.to} fill={b.fill} fillOpacity={0.05} label={{ value: b.label, position: "insideTop", fill: "#8f95a8", fontSize: 11 }} />
              ))}
              <CartesianGrid vertical={false} />
              <XAxis dataKey="step" type="number" domain={[1, 49]} tickLine={false} axisLine={false} ticks={[1, 10, 20, 29, 34, 40, 49]} />
              <YAxis tickLine={false} axisLine={false} width={40} />
              <ChartTooltip content={<ChartTooltipContent labelFormatter={(_, p) => `Step ${p?.[0]?.payload?.step}`} />} />
              <ChartLegend content={<ChartLegendContent />} />
              <Area dataKey="total" type="monotone" stroke="var(--color-total)" fill="var(--color-total)" fillOpacity={0.15} />
              <Area dataKey="labelled" type="monotone" stroke="var(--color-labelled)" fill="var(--color-labelled)" fillOpacity={0.15} />
              <Area dataKey="illicit" type="monotone" stroke="var(--color-illicit)" fill="var(--color-illicit)" fillOpacity={0.25} />
            </AreaChart>
          </ChartContainer>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="font-normal">Illicit share of labelled transactions</CardTitle>
          <CardDescription>The test window is harder: the share drops after step 34</CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer config={shareCfg} className="h-56 w-full">
            <LineChart data={share}>
              <ReferenceArea x1={34.5} x2={49} fill="#82ca9d" fillOpacity={0.05} />
              <CartesianGrid vertical={false} />
              <XAxis dataKey="step" type="number" domain={[1, 49]} tickLine={false} axisLine={false} ticks={[1, 10, 20, 29, 34, 40, 49]} />
              <YAxis unit="%" tickLine={false} axisLine={false} width={40} />
              <ChartTooltip content={<ChartTooltipContent labelFormatter={(_, p) => `Step ${p?.[0]?.payload?.step}`} />} />
              <Line dataKey="share" type="monotone" stroke="var(--color-share)" dot={false} strokeWidth={1.5} />
            </LineChart>
          </ChartContainer>
        </CardContent>
      </Card>
    </>
  );
}
