"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Network } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { useDash } from "@/lib/dash/store";
import { fmtTime } from "@/lib/dash/format";
import { LabelBadge, ScoreBar, StatusBadge } from "./bits";

export function AlertSheet({ id, onClose }: { id: number | null; onClose: () => void }) {
  const alert = useDash((s) => s.alerts.find((a) => a.id === id) ?? null);
  const cases = useDash((s) => s.cases);
  const { assign, setStatus, escalate, addNote, setFocus } = useDash.getState();
  const [note, setNote] = useState("");
  const [target, setTarget] = useState<string>("new");
  const caseItems = useMemo(
    () => [{ value: "new", label: "New case" }, ...cases.filter((c) => c.status !== "closed").map((c) => ({ value: c.id, label: `${c.id} · ${c.title}` }))],
    [cases],
  );
  const maxShap = alert ? Math.max(...alert.shap.map((s) => Math.abs(s.shap))) : 1;

  return (
    <Sheet open={id != null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        {alert ? (
          <>
            <SheetHeader>
              <SheetTitle className="font-mono text-lg font-normal">tx {alert.id}</SheetTitle>
              <SheetDescription>
                Step {alert.step} · flagged {fmtTime(alert.flaggedAt)}
              </SheetDescription>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <LabelBadge label={alert.label} />
                <StatusBadge status={alert.status} />
                {alert.caseId ? <span className="rounded-full border px-2 py-0.5 font-mono text-[11px]">{alert.caseId}</span> : null}
                <span className="text-xs text-muted-foreground">{alert.assignee ? `assigned to ${alert.assignee}` : "unassigned"}</span>
              </div>
            </SheetHeader>
            <div className="grid gap-6 px-4 pb-6">
              <section>
                <h3 className="mb-2 font-mono text-[11px] tracking-wide text-muted-foreground uppercase">Scores</h3>
                <div className="grid gap-2 rounded-xl border bg-card p-3">
                  {(
                    [
                      ["Hybrid (calibrated)", alert.hybrid],
                      ["XGBoost", alert.xgb],
                      ["GraphSAGE", alert.gnn],
                      ["Autoencoder", alert.ae],
                      ["Isolation forest", alert.iso],
                    ] as const
                  ).map(([k, v]) => (
                    <div key={k} className="grid grid-cols-[9rem_1fr] items-center gap-2 text-sm">
                      <span className="text-muted-foreground">{k}</span>
                      <ScoreBar value={v} />
                    </div>
                  ))}
                </div>
              </section>
              <section>
                <h3 className="mb-2 font-mono text-[11px] tracking-wide text-muted-foreground uppercase">Why it was flagged (SHAP)</h3>
                <div className="grid gap-1.5 rounded-xl border bg-card p-3">
                  {alert.shap.map((s) => (
                    <div key={s.feature} className="grid grid-cols-[6.5rem_1fr_3.5rem] items-center gap-2 font-mono text-xs">
                      <span>{s.feature}</span>
                      <div className="relative h-2 rounded-full bg-muted">
                        <div
                          className="absolute top-0 h-2 rounded-full"
                          style={{
                            left: s.shap >= 0 ? "50%" : `${50 - (Math.abs(s.shap) / maxShap) * 50}%`,
                            width: `${(Math.abs(s.shap) / maxShap) * 50}%`,
                            background: s.shap >= 0 ? "#F2716B" : "#5FA8F5",
                          }}
                        />
                        <div className="absolute top-[-2px] left-1/2 h-3 w-px bg-border" />
                      </div>
                      <span className="text-right tabular-nums">{s.shap > 0 ? "+" : ""}{s.shap.toFixed(2)}</span>
                    </div>
                  ))}
                  <p className="pt-1 text-[11px] text-muted-foreground">Red pushes toward illicit, blue toward licit.</p>
                </div>
              </section>
              <section className="flex items-center justify-between rounded-xl border bg-card p-3 text-sm">
                <span className="text-muted-foreground">
                  {alert.inDeg} inbound · {alert.outDeg} outbound flows
                </span>
                <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/dashboard/flow/" onClick={() => setFocus(alert.id)} />}>
                  <Network /> Open in flow canvas
                </Button>
              </section>
              <section className="grid gap-2">
                <h3 className="font-mono text-[11px] tracking-wide text-muted-foreground uppercase">Actions</h3>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" onClick={() => { assign([alert.id]); toast.add({ title: "Assigned to you", description: `tx ${alert.id}`, type: "success" }); }}>
                    Assign to me
                  </Button>
                  <Button size="sm" variant="secondary" disabled={alert.status === "cleared"} onClick={() => { setStatus([alert.id], "cleared"); toast.add({ title: "Cleared as false positive", description: `tx ${alert.id}`, type: "success" }); }}>
                    Clear
                  </Button>
                  {alert.status === "cleared" || alert.status === "escalated" ? (
                    <Button size="sm" variant="ghost" onClick={() => { setStatus([alert.id], "reviewing"); toast.add({ title: "Reopened", description: `tx ${alert.id}`, type: "info" }); }}>
                      Reopen
                    </Button>
                  ) : null}
                </div>
                <div className="flex gap-2">
                  <Select value={target} onValueChange={(v) => setTarget(String(v))} items={caseItems}>
                    <SelectTrigger className="flex-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {caseItems.map((c) => (
                        <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    variant="destructive"
                    className="h-8"
                    onClick={() => {
                      const cid = escalate([alert.id], target as string, `Case from tx ${alert.id}`);
                      toast.add({ title: `Escalated to ${cid}`, description: `tx ${alert.id}`, type: "warning" });
                    }}
                  >
                    Escalate
                  </Button>
                </div>
              </section>
              <section className="grid gap-2">
                <h3 className="font-mono text-[11px] tracking-wide text-muted-foreground uppercase">Notes</h3>
                {alert.notes.length ? (
                  <ul className="grid gap-2">
                    {alert.notes.map((n, i) => (
                      <li key={i} className="rounded-lg border bg-card p-2 text-sm">
                        <p>{n.text}</p>
                        <p className="mt-1 text-[11px] text-muted-foreground">{n.by} · {fmtTime(n.at)}</p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">No notes yet.</p>
                )}
                <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note for the next reviewer" />
                <Button
                  size="sm"
                  className="justify-self-start"
                  disabled={!note.trim()}
                  onClick={() => { addNote(alert.id, note.trim()); setNote(""); toast.add({ title: "Note added", type: "success" }); }}
                >
                  Add note
                </Button>
              </section>
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
