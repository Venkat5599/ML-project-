"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import { inQueue, useDash, type Settings } from "@/lib/dash/store";

const BUDGETS = [50, 100, 250].map((k) => ({ value: String(k), label: `Top ${k} alerts` }));

export default function SettingsPage() {
  const settings = useDash((s) => s.settings);
  const alerts = useDash((s) => s.alerts);
  const { updateSettings, reset } = useDash.getState();
  const [draft, setDraft] = useState<Settings>(settings);
  const [confirm, setConfirm] = useState(false);
  useEffect(() => setDraft(settings), [settings]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);
  const preview = inQueue(alerts, draft.threshold).length;

  return (
    <div className="grid max-w-3xl gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="font-normal">Alert queue</CardTitle>
          <CardDescription>What lands in the queue and how much a reviewer works per shift</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          <label className="grid gap-2">
            <span className="flex justify-between text-sm">
              <span>Score threshold</span>
              <span className="font-mono text-xs text-muted-foreground">{draft.threshold.toFixed(2)} · {preview} alerts</span>
            </span>
            <input type="range" min={0} max={1} step={0.05} value={draft.threshold} onChange={(e) => setDraft({ ...draft, threshold: Number(e.target.value) })} />
          </label>
          <div className="grid gap-2">
            <Label>Review budget</Label>
            <Select value={String(draft.budget)} onValueChange={(v) => setDraft({ ...draft, budget: Number(v) })} items={BUDGETS}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>{BUDGETS.map((b) => <SelectItem key={b.value} value={b.value}>{b.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="font-normal">Reviewer</CardTitle>
          <CardDescription>Shown on notes, assignments and the activity feed</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          <div className="grid gap-2">
            <Label htmlFor="analyst">Display name</Label>
            <Input id="analyst" value={draft.analyst} onChange={(e) => setDraft({ ...draft, analyst: e.target.value })} className="max-w-xs" />
          </div>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm">Notify on escalations</p>
              <p className="text-xs text-muted-foreground">Toast when anyone escalates into a case you own</p>
            </div>
            <Switch checked={draft.notifyEscalations} onCheckedChange={(v) => setDraft({ ...draft, notifyEscalations: v })} />
          </div>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm">Auto-assign new alerts to me</p>
              <p className="text-xs text-muted-foreground">New queue items above the threshold go to your name</p>
            </div>
            <Switch checked={draft.autoAssign} onCheckedChange={(v) => setDraft({ ...draft, autoAssign: v })} />
          </div>
        </CardContent>
        <CardFooter className="gap-2">
          <Button
            disabled={!dirty || !draft.analyst.trim()}
            onClick={() => {
              updateSettings({ ...draft, analyst: draft.analyst.trim() });
              if (draft.autoAssign && !settings.autoAssign) {
                const ids = inQueue(alerts, draft.threshold).filter((a) => a.status === "new").map((a) => a.id);
                if (ids.length) useDash.getState().assign(ids, draft.analyst.trim());
              }
              toast.add({ title: "Settings saved", type: "success" });
            }}
          >
            Save
          </Button>
          <Button variant="ghost" disabled={!dirty} onClick={() => setDraft(settings)}>Discard</Button>
        </CardFooter>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="font-normal">Mock session</CardTitle>
          <CardDescription>Alerts, cases and activity on this console are generated sample data, saved in this browser only</CardDescription>
        </CardHeader>
        <CardFooter>
          <Button variant="destructive" onClick={() => setConfirm(true)}>Reset mock data</Button>
        </CardFooter>
      </Card>
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-normal">Reset the mock session?</DialogTitle>
            <DialogDescription>Every assignment, escalation, case and note you made here is discarded.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirm(false)}>Cancel</Button>
            <Button variant="destructive" onClick={() => { reset(); setConfirm(false); toast.add({ title: "Mock data reset", type: "info" }); }}>Reset</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
