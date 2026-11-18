import type { Metadata } from "next";
import type React from "react";
import "./dashboard.css";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/toast";
import { AppSidebar } from "@/components/dash/app-sidebar";
import { SiteHeader } from "@/components/dash/site-header";
import { Connect } from "@/components/dash/connect";

export const metadata: Metadata = {
  title: "Console | ChainSleuth AML",
  description: "Investigation console for ChainSleuth AML alerts (scores and analyst actions served by the local FastAPI backend).",
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <Toaster>
      <SidebarProvider
        style={{ "--sidebar-width": "16rem", "--header-height": "3.5rem" } as React.CSSProperties}
      >
        <AppSidebar />
        <SidebarInset>
          <SiteHeader />
          <div className="flex flex-1 flex-col gap-4 p-4 md:gap-6 md:p-6">
            <Connect>{children}</Connect>
          </div>
        </SidebarInset>
      </SidebarProvider>
    </Toaster>
  );
}
