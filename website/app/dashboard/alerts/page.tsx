"use client";

import { useMemo, useState } from "react";
import { ArrowDownUp, ChevronLeft, ChevronRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import { AlertSheet } from "@/components/dash/alert-sheet";
import { LabelBadge, ScoreBar, StatusBadge } from "@/components/dash/bits";
import { useDash } from "@/lib/dash/store";
import { fmtTime } from "@/lib/dash/format";

const PAGE = 15;
const LABELS = [
  { value: "all", label: "All labels" },
  { value: "illicit", label: "Illicit" },
  { value: "unknown", label: "Unknown" },
  { value: "licit", label: "Licit" },
];
const STATUSES = [
  { value: "open", label: "Open (new + reviewing)" },
  { value: "all", label: "All statuses" },
  { value: "new", label: "New" },
  { value: "reviewing", label: "Reviewing" },
  { value: "escalated", label: "Escalated" },
  { value: "cleared", label: "Cleared" },
];
type SortKey = "hybrid" | "step" | "flaggedAt";

export default function AlertsPage() {
  const alerts = useDash((s) => s.alerts);
  const cases = useDash((s) => s.cases);
  const threshold = useDash((s) => s.settings.threshold);
  const query = useDash((s) => s.query);
  const { setQuery, assign, setStatus, escalate } = useDash.getState();
  const [label, setLabel] = useState("all");
  const [status, setStatusF] = useState("open");
  const [minScore, setMinScore] = useState<number | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "hybrid", dir: -1 });
  const [page, setPage] = useState(0);
  const [sel, setSel] = useState<number[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  const [escOpen, setEscOpen] = useState(false);
  const [escTarget, setEscTarget] = useState("new");
  const [escTitle, setEscTitle] = useState("");

  const min = minScore ?? threshold;
  const rows = useMemo(() => {
    const q = query.trim();
    return alerts
      .filter((a) => a.hybrid >= min)
      .filter((a) => label === "all" || a.label === label)
      .filter((a) => (status === "all" ? true : status === "open" ? a.status === "new" || a.status === "reviewing" : a.status === status))
      .filter((a) => !q || String(a.id).includes(q))
      .sort((a, b) => (a[sort.key] - b[sort.key]) * sort.dir);
  }, [alerts, min, label, status, query, sort]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const p = Math.min(page, pages - 1);
  const view = rows.slice(p * PAGE, p * PAGE + PAGE);
  const allOnPage = view.length > 0 && view.every((a) => sel.includes(a.id));
  const caseItems = [{ value: "new", label: "New case" }, ...cases.filter((c) => c.status !== "closed").map((c) => ({ value: c.id, label: `${c.id} · ${c.title}` }))];

  const sortBy = (key: SortKey) => setSort((s) => ({ key, dir: s.key === key ? ((-s.dir) as 1 | -1) : -1 }));
  const done = (title: string) => {
    toast.add({ title, description: `${sel.length} alert${sel.length === 1 ? "" : "s"}`, type: "success" });
    setSel([]);
  };

  return (
    <>
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="grid gap-1">
            <span className="text-xs text-muted-foreground">Transaction id</span>
            <div className="relative">
              <Input value={query} onChange={(e) => { setQuery(e.target.value); setPage(0); }} placeholder="e.g. 4815…" className="w-44 pr-7 font-mono text-xs" />
              {query ? (
                <button aria-label="Clear search" className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground" onClick={() => setQuery("")}>
                  <X className="size-3.5" />
                </button>
              ) : null}
            </div>
          </div>
          <div className="grid gap-1">
            <span className="text-xs text-muted-foreground">Label</span>
            <Select value={label} onValueChange={(v) => { setLabel(String(v)); setPage(0); }} items={LABELS}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>{LABELS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid gap-1">
            <span className="text-xs text-muted-foreground">Status</span>
            <Select value={status} onValueChange={(v) => { setStatusF(String(v)); setPage(0); }} items={STATUSES}>
              <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
              <SelectContent>{STATUSES.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <label className="grid gap-1">
            <span className="text-xs text-muted-foreground">Min score {min.toFixed(2)}</span>
            <input type="range" min={0} max={1} step={0.05} value={min} onChange={(e) => { setMinScore(Number(e.target.value)); setPage(0); }} className="h-8 w-40" />
          </label>
          <p className="ml-auto text-sm text-muted-foreground">{rows.length} alerts</p>
        </CardContent>
      </Card>

      {sel.length ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card px-4 py-2 text-sm">
          <span>{sel.length} selected</span>
          <Button size="sm" variant="secondary" onClick={() => { assign(sel); done("Assigned to you"); }}>Assign to me</Button>
          <Button size="sm" variant="secondary" onClick={() => { setStatus(sel, "cleared"); done("Cleared as false positives"); }}>Clear</Button>
          <Button size="sm" variant="destructive" onClick={() => setEscOpen(true)}>Escalate…</Button>
          <Button size="sm" variant="ghost" onClick={() => setSel([])}>Deselect</Button>
        </div>
      ) : null}

      <Card className="py-0">
        <CardContent className="overflow-x-auto px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10 pl-4">
                  <Checkbox
                    aria-label="Select page"
                    checked={allOnPage}
                    onCheckedChange={(c) => setSel((s) => (c ? [...new Set([...s, ...view.map((a) => a.id)])] : s.filter((id) => !view.some((a) => a.id === id))))}
                  />
                </TableHead>
                <TableHead>Transaction</TableHead>
                <TableHead><button className="inline-flex items-center gap-1" onClick={() => sortBy("step")}>Step <ArrowDownUp className="size-3" /></button></TableHead>
                <TableHead>Label</TableHead>
                <TableHead><button className="inline-flex items-center gap-1" onClick={() => sortBy("hybrid")}>Hybrid <ArrowDownUp className="size-3" /></button></TableHead>
                <TableHead>XGBoost</TableHead>
                <TableHead>GraphSAGE</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Assignee</TableHead>
                <TableHead className="pr-4 text-right"><button className="inline-flex items-center gap-1" onClick={() => sortBy("flaggedAt")}>Flagged <ArrowDownUp className="size-3" /></button></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {view.map((a) => (
                <TableRow key={a.id} data-state={sel.includes(a.id) ? "selected" : undefined} className="cursor-pointer" onClick={() => setOpen(a.id)}>
                  <TableCell className="pl-4" onClick={(e) => e.stopPropagation()}>
                    <Checkbox aria-label={`Select tx ${a.id}`} checked={sel.includes(a.id)} onCheckedChange={(c) => setSel((s) => (c ? [...s, a.id] : s.filter((x) => x !== a.id)))} />
                  </TableCell>
                  <TableCell className="font-mono">{a.id}</TableCell>
                  <TableCell className="font-mono">t{a.step}</TableCell>
                  <TableCell><LabelBadge label={a.label} /></TableCell>
                  <TableCell><ScoreBar value={a.hybrid} /></TableCell>
                  <TableCell className="font-mono text-xs">{a.xgb.toFixed(3)}</TableCell>
                  <TableCell className="font-mono text-xs">{a.gnn.toFixed(3)}</TableCell>
                  <TableCell><StatusBadge status={a.status} /></TableCell>
                  <TableCell className="text-sm text-muted-foreground">{a.assignee ?? "–"}</TableCell>
                  <TableCell className="pr-4 text-right text-xs text-muted-foreground">{fmtTime(a.flaggedAt)}</TableCell>
                </TableRow>
              ))}
              {!view.length ? (
                <TableRow>
                  <TableCell colSpan={10} className="py-10 text-center text-muted-foreground">No alerts match these filters.</TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="flex items-center justify-end gap-2 text-sm">
        <span className="text-muted-foreground">Page {p + 1} of {pages}</span>
        <Button size="icon-sm" variant="outline" aria-label="Previous page" disabled={p === 0} onClick={() => setPage(p - 1)}><ChevronLeft /></Button>
        <Button size="icon-sm" variant="outline" aria-label="Next page" disabled={p >= pages - 1} onClick={() => setPage(p + 1)}><ChevronRight /></Button>
      </div>

      <Dialog open={escOpen} onOpenChange={setEscOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-normal">Escalate {sel.length} alert{sel.length === 1 ? "" : "s"}</DialogTitle>
            <DialogDescription>Attach them to an open case, or start a new one.</DialogDescription>
          </DialogHeader>
          <Select value={escTarget} onValueChange={(v) => setEscTarget(String(v))} items={caseItems}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>{caseItems.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
          </Select>
          {escTarget === "new" ? <Input value={escTitle} onChange={(e) => setEscTitle(e.target.value)} placeholder="Case title" /> : null}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEscOpen(false)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => {
                const id = escalate(sel, escTarget, escTitle.trim() || undefined);
                setEscOpen(false);
                setEscTitle("");
                done(`Escalated to ${id}`);
              }}
            >
              Escalate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertSheet id={open} onClose={() => setOpen(null)} />
    </>
  );
}
