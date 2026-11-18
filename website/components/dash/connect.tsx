"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { RefreshCw, ServerOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDash } from "@/lib/dash/store";

/** Pages built from committed results/metrics; they render without the backend. */
const STATIC = new Set(["/dashboard/models", "/dashboard/steps"]);

/** Loads the console snapshot from the backend once, and blocks the live pages with a clear notice while it is offline. */
export function Connect({ children }: { children: React.ReactNode }) {
  const conn = useDash((s) => s.conn);
  const error = useDash((s) => s.error);
  const load = useDash((s) => s.load);
  const path = usePathname().replace(/\/$/, "");

  useEffect(() => {
    void load();
  }, [load]);

  if (conn === "live" || STATIC.has(path)) return <>{children}</>;
  if (conn === "loading") {
    return <p className="py-16 text-center font-mono text-sm text-muted-foreground">Reading scores from the backend…</p>;
  }
  return (
    <div className="mx-auto grid max-w-lg gap-4 rounded-xl border bg-card p-6 text-sm">
      <div className="flex items-center gap-2 text-base">
        <ServerOff className="size-5 text-warning" /> Backend offline
      </div>
      <p className="text-muted-foreground">{error}</p>
      <p className="text-muted-foreground">The console reads model scores and saves analyst actions through the local API. Start it from the project root:</p>
      <pre className="overflow-x-auto rounded-lg bg-muted p-3 font-mono text-xs">python -m uvicorn backend.main:app --port 8000</pre>
      <p className="text-muted-foreground">
        It needs <code className="font-mono text-xs">data/processed/test_scores.parquet</code>, written by{" "}
        <code className="font-mono text-xs">python -m experiments.hybrid</code>.
      </p>
      <Button className="justify-self-start" variant="secondary" onClick={() => void load()}>
        <RefreshCw /> Retry
      </Button>
    </div>
  );
}
