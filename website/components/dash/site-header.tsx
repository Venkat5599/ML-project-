"use client";

import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useDash } from "@/lib/dash/store";
import { GithubIcon } from "./github-icon";

const TITLES: Record<string, string> = {
  "/dashboard": "Overview",
  "/dashboard/alerts": "Alert queue",
  "/dashboard/flow": "Flow canvas",
  "/dashboard/cases": "Cases",
  "/dashboard/models": "Model comparison",
  "/dashboard/steps": "Time steps",
  "/dashboard/settings": "Settings",
};
const STATIC = new Set(["/dashboard/models", "/dashboard/steps"]);

export function SiteHeader() {
  const path = usePathname().replace(/\/$/, "");
  const router = useRouter();
  const setQuery = useDash((s) => s.setQuery);
  const conn = useDash((s) => s.conn);
  const [q, setQ] = useState("");

  return (
    <header className="flex h-(--header-height) shrink-0 items-center gap-2 border-b">
      <div className="flex w-full items-center gap-2 px-4 lg:px-6">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mx-1 data-vertical:h-4 data-vertical:self-center" />
        <h1 className="truncate text-base font-normal">{TITLES[path] ?? "Console"}</h1>
        {STATIC.has(path) ? (
          <Badge variant="outline" className="hidden border-chart-2/40 text-chart-2 sm:inline-flex">
            from results/metrics
          </Badge>
        ) : conn === "live" ? (
          <Badge variant="outline" className="hidden border-success/40 text-success sm:inline-flex">
            live · local backend
          </Badge>
        ) : (
          <Badge variant="outline" className="hidden border-warning/40 text-warning sm:inline-flex">
            {conn === "loading" ? "connecting…" : "backend offline"}
          </Badge>
        )}
        <form
          className="ml-auto hidden w-full max-w-xs md:block"
          onSubmit={(e) => {
            e.preventDefault();
            setQuery(q.trim());
            router.push("/dashboard/alerts/");
          }}
        >
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Find a transaction id…"
              aria-label="Find a transaction id"
              className="pl-8 font-mono text-xs"
            />
          </div>
        </form>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto md:ml-0"
          nativeButton={false}
          render={<a href="https://github.com/Venkat5599/ML-project-" target="_blank" rel="noreferrer" />}
        >
          <GithubIcon className="size-4" />
          <span className="hidden sm:inline">GitHub</span>
        </Button>
      </div>
    </header>
  );
}
