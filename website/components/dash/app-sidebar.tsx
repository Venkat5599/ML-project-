"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowLeft,
  BarChart3,
  Briefcase,
  CalendarRange,
  LayoutDashboard,
  ListFilter,
  Network,
  Settings,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { Mark } from "./mark";
import { GithubIcon } from "./github-icon";
import { inQueue, useDash } from "@/lib/dash/store";

const REPO = "https://github.com/Venkat5599/ML-project-";

export function AppSidebar() {
  const path = usePathname();
  const alerts = useDash((s) => s.alerts);
  const cases = useDash((s) => s.cases);
  const settings = useDash((s) => s.settings);
  const newCount = inQueue(alerts, settings.threshold).filter((a) => a.status === "new").length;
  const openCases = cases.filter((c) => c.status !== "closed").length;

  const groups = [
    {
      label: "Investigate",
      items: [
        { title: "Overview", url: "/dashboard/", icon: LayoutDashboard },
        { title: "Alert queue", url: "/dashboard/alerts/", icon: ListFilter, badge: newCount },
        { title: "Flow canvas", url: "/dashboard/flow/", icon: Network },
        { title: "Cases", url: "/dashboard/cases/", icon: Briefcase, badge: openCases },
      ],
    },
    {
      label: "Models",
      items: [
        { title: "Model comparison", url: "/dashboard/models/", icon: BarChart3 },
        { title: "Time steps", url: "/dashboard/steps/", icon: CalendarRange },
      ],
    },
    { label: "System", items: [{ title: "Settings", url: "/dashboard/settings/", icon: Settings }] },
  ];
  const active = (url: string) => path === url || path + "/" === url;

  return (
    <Sidebar variant="inset" collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<a href="/" aria-label="ChainSleuth home page" />}>
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-white text-[#0c0c14]">
                <Mark className="size-5" />
              </div>
              <div className="grid flex-1 text-left leading-tight">
                <span className="truncate text-sm font-medium tracking-wide">ChainSleuth</span>
                <span className="truncate font-mono text-[11px] text-muted-foreground">investigation console</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {groups.map((g) => (
          <SidebarGroup key={g.label}>
            <SidebarGroupLabel>{g.label}</SidebarGroupLabel>
            <SidebarMenu>
              {g.items.map((it) => (
                <SidebarMenuItem key={it.url}>
                  <SidebarMenuButton tooltip={it.title} isActive={active(it.url)} render={<Link href={it.url} />}>
                    <it.icon />
                    <span>{it.title}</span>
                  </SidebarMenuButton>
                  {"badge" in it && it.badge ? <SidebarMenuBadge>{it.badge}</SidebarMenuBadge> : null}
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="Back to site" render={<a href="/" />}>
              <ArrowLeft />
              <span>Back to site</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="Repository" render={<a href={REPO} target="_blank" rel="noreferrer" />}>
              <GithubIcon className="size-4" />
              <span>Repository</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <div className="flex items-center gap-2 rounded-lg border border-sidebar-border p-2 group-data-[collapsible=icon]:hidden">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-sidebar-accent font-mono text-xs">
                {settings.analyst.slice(0, 2).toUpperCase()}
              </div>
              <div className="grid min-w-0 leading-tight">
                <span className="truncate text-sm">{settings.analyst}</span>
                <span className="truncate font-mono text-[11px] text-muted-foreground">analyst · mock session</span>
              </div>
            </div>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
