"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { AlertSheet } from "@/components/dash/alert-sheet";
import { LabelBadge, ScoreBar, StatusBadge } from "@/components/dash/bits";
import { useDash } from "@/lib/dash/store";
import { fmtTime } from "@/lib/dash/format";

export default function CasesPage() {
  const cases = useDash((s) => s.cases);
  const alerts = useDash((s) => s.alerts);
  const { createCase, setCaseStatus, addCaseNote, removeFromCase } = useDash.getState();
  const [newOpen, setNewOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [alertId, setAlertId] = useState<number | null>(null);
  const c = cases.find((x) => x.id === openId) ?? null;
  const byId = new Map(alerts.map((a) => [a.id, a]));

  return (
    <>
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {cases.filter((x) => x.status !== "closed").length} open · {cases.filter((x) => x.status === "closed").length} closed
        </p>
        <Button onClick={() => setNewOpen(true)}>
          <Plus /> New case
        </Button>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {cases.map((x) => {
          const txs = x.txs.map((t) => byId.get(t)).filter(Boolean);
          const peak = Math.max(0, ...txs.map((a) => a!.hybrid));
          return (
            <Card key={x.id} className="cursor-pointer transition-colors hover:border-ring" onClick={() => setOpenId(x.id)}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-muted-foreground">{x.id}</span>
                  <StatusBadge status={x.status} />
                </div>
                <CardTitle className="font-normal">{x.title}</CardTitle>
                <CardDescription>
                  {x.owner} · opened {fmtTime(x.createdAt)}
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Linked transactions</span>
                  <span className="font-mono">{x.txs.length}</span>
                </div>
                <div className="grid grid-cols-[auto_1fr] items-center gap-3">
                  <span className="text-muted-foreground">Peak score</span>
                  <ScoreBar value={txs.length ? peak : null} />
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-normal">New case</DialogTitle>
            <DialogDescription>Escalate alerts into it from the queue or an alert&apos;s panel.</DialogDescription>
          </DialogHeader>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Fan-in to exchange hub, step 44" />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setNewOpen(false)}>Cancel</Button>
            <Button
              disabled={!title.trim()}
              onClick={() => {
                const id = createCase(title.trim());
                setTitle("");
                setNewOpen(false);
                toast.add({ title: `${id} opened`, type: "success" });
              }}
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Sheet open={!!c} onOpenChange={(o) => !o && setOpenId(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          {c ? (
            <>
              <SheetHeader>
                <span className="font-mono text-xs text-muted-foreground">{c.id}</span>
                <SheetTitle className="text-lg font-normal">{c.title}</SheetTitle>
                <SheetDescription>{c.owner} · opened {fmtTime(c.createdAt)}</SheetDescription>
                <div className="flex gap-2 pt-1">
                  <StatusBadge status={c.status} />
                </div>
              </SheetHeader>
              <div className="grid gap-6 px-4 pb-6">
                <div className="flex flex-wrap gap-2">
                  {c.status === "closed" ? (
                    <Button size="sm" variant="secondary" onClick={() => { setCaseStatus(c.id, "open"); toast.add({ title: `${c.id} reopened`, type: "info" }); }}>Reopen</Button>
                  ) : (
                    <>
                      {c.status === "open" ? (
                        <Button size="sm" variant="secondary" onClick={() => { setCaseStatus(c.id, "in review"); toast.add({ title: `${c.id} moved to review`, type: "info" }); }}>Move to review</Button>
                      ) : null}
                      <Button size="sm" variant="secondary" onClick={() => { setCaseStatus(c.id, "closed"); toast.add({ title: `${c.id} closed`, type: "success" }); }}>Close case</Button>
                    </>
                  )}
                </div>
                <section className="grid gap-2">
                  <h3 className="font-mono text-[11px] tracking-wide text-muted-foreground uppercase">Linked transactions</h3>
                  {c.txs.length ? (
                    <ul className="grid gap-2">
                      {c.txs.map((t) => {
                        const a = byId.get(t);
                        return (
                          <li key={t} className="flex items-center gap-3 rounded-lg border bg-card p-2">
                            <button className="font-mono text-sm hover:underline" onClick={() => setAlertId(t)}>{t}</button>
                            {a ? <LabelBadge label={a.label} /> : null}
                            {a ? <ScoreBar value={a.hybrid} className="flex-1" /> : <span className="flex-1" />}
                            <Button size="xs" variant="ghost" onClick={() => { removeFromCase(c.id, t); toast.add({ title: `Removed tx ${t}`, type: "info" }); }}>Remove</Button>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted-foreground">No transactions yet. Escalate alerts into this case.</p>
                  )}
                </section>
                <section className="grid gap-2">
                  <h3 className="font-mono text-[11px] tracking-wide text-muted-foreground uppercase">Notes</h3>
                  {c.notes.map((n, i) => (
                    <div key={i} className="rounded-lg border bg-card p-2 text-sm">
                      <p>{n.text}</p>
                      <p className="mt-1 text-[11px] text-muted-foreground">{n.by} · {fmtTime(n.at)}</p>
                    </div>
                  ))}
                  <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a case note" />
                  <Button size="sm" className="justify-self-start" disabled={!note.trim()} onClick={() => { addCaseNote(c.id, note.trim()); setNote(""); toast.add({ title: "Note added", type: "success" }); }}>
                    Add note
                  </Button>
                </section>
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
      <AlertSheet id={alertId} onClose={() => setAlertId(null)} />
    </>
  );
}
