"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import WorkflowView from "./views/WorkflowView";
import { reducedMotion, type B, type K } from "./bind";

const TABS = 4;

/** Audience tabs: one panel at a time; its cards slide in on selection. */
export default function Workflow() {
  const [sel, setSel] = useState(0);
  const [edge, setEdge] = useState({ prev: true, next: true });
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const panels = useRef<(HTMLDivElement | null)[]>([]);
  const list = useRef<HTMLDivElement | null>(null);
  const focusNext = useRef(false);

  const edges = useCallback(() => {
    const l = list.current;
    if (!l) return;
    const max = l.scrollWidth - l.clientWidth;
    setEdge({ prev: l.scrollLeft <= 2, next: l.scrollLeft >= max - 2 });
  }, []);

  useEffect(() => {
    edges();
    window.addEventListener("resize", edges);
    return () => window.removeEventListener("resize", edges);
  }, [edges]);

  // staggered slide-in of the selected panel's cards
  useEffect(() => {
    if (focusNext.current) {
      tabs.current[sel]?.focus();
      focusNext.current = false;
    }
    if (reducedMotion()) return;
    const p = panels.current[sel];
    if (!p) return;
    p.querySelectorAll<HTMLElement>("article").forEach((a, n) => {
      a.style.transition = "none";
      a.style.opacity = "0";
      a.style.transform = "translateX(24px)";
      void a.offsetWidth;
      a.style.transition = `opacity 450ms ease-out ${n * 70}ms, transform 450ms cubic-bezier(.2,.7,.2,1) ${n * 70}ms`;
      a.style.opacity = "1";
      a.style.transform = "translateX(0px)";
    });
  }, [sel]);

  const b: B = (key, i, base) => {
    const on = i === sel;
    switch (key) {
      case "tab":
        return {
          className: base,
          "aria-selected": on ? "true" : "false",
          "data-state": on ? "active" : "inactive",
          tabIndex: on ? 0 : -1,
          ref: (el: HTMLButtonElement | null) => {
            tabs.current[i] = el;
          },
          onClick: () => setSel(i),
          onKeyDown: (e: React.KeyboardEvent) => {
            if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
            e.preventDefault();
            focusNext.current = true;
            setSel((i + (e.key === "ArrowRight" ? 1 : TABS - 1)) % TABS);
          },
        };
      case "panel":
        return {
          className: base,
          "data-state": on ? "active" : "inactive",
          hidden: !on,
          ref: (el: HTMLDivElement | null) => {
            panels.current[i] = el;
          },
        };
      case "tablist":
        return { className: base, ref: list, onScroll: edges };
      case "tabs-prev":
        return { className: base, disabled: edge.prev, onClick: () => list.current?.scrollBy({ left: -160, behavior: "smooth" }) };
      case "tabs-next":
        return { className: base, disabled: edge.next, onClick: () => list.current?.scrollBy({ left: 160, behavior: "smooth" }) };
    }
    return { className: base };
  };
  const k: K = () => null;

  return <WorkflowView b={b} k={k} />;
}
