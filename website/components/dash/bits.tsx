import { cn } from "@/lib/utils";
import type { CaseStatus, Label, Status } from "@/lib/dash/mock";

export const LABEL_COLOR: Record<Label, string> = { illicit: "#F2716B", licit: "#5FA8F5", unknown: "#8B90A6" };

export function LabelBadge({ label, className }: { label: Label; className?: string }) {
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[11px]", className)}
      style={{ borderColor: LABEL_COLOR[label] + "55", color: LABEL_COLOR[label] }}
    >
      <span className="size-1.5 rounded-full" style={{ background: LABEL_COLOR[label] }} />
      {label}
    </span>
  );
}

const STATUS_CLS: Record<Status | CaseStatus, string> = {
  new: "border-info/40 text-info",
  reviewing: "border-chart-3/40 text-chart-3",
  escalated: "border-destructive/40 text-destructive",
  cleared: "border-success/40 text-success",
  open: "border-destructive/40 text-destructive",
  "in review": "border-chart-3/40 text-chart-3",
  closed: "border-border text-muted-foreground",
};

export function StatusBadge({ status }: { status: Status | CaseStatus }) {
  return <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-[11px] capitalize", STATUS_CLS[status])}>{status}</span>;
}

export function ScoreBar({ value, className }: { value: number | null; className?: string }) {
  if (value == null) return <span className="font-mono text-xs text-muted-foreground">–</span>;
  const hot = value >= 0.7;
  return (
    <div className={cn("flex min-w-24 items-center gap-2", className)}>
      <span className={cn("w-10 font-mono text-xs tabular-nums", hot ? "text-chart-3" : "text-foreground/80")}>{value.toFixed(3)}</span>
      <div className="h-1 flex-1 rounded-full bg-muted">
        <div className={cn("h-1 rounded-full", hot ? "bg-chart-3" : "bg-muted-foreground")} style={{ width: `${Math.min(100, value * 100)}%` }} />
      </div>
    </div>
  );
}

export function Kpi({ title, value, hint }: { title: string; value: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="font-mono text-[11px] tracking-wide text-muted-foreground uppercase">{title}</p>
      <p className="mt-2 text-3xl font-extralight tabular-nums">{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
