"use client";

import { useEffect } from "react";
import { reducedMotion } from "./bind";

/** Page-wide behaviour: reveal-on-view, in-page anchors inside the scroll container, "/" to search. */
export default function PageEffects() {
  useEffect(() => {
    const doc = document.documentElement;
    doc.classList.add("js");
    const els = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]"));
    const showAll = () => els.forEach((el) => el.classList.add("is-in"));
    let io: IntersectionObserver | undefined;
    let t: ReturnType<typeof setTimeout> | undefined;
    if (!("IntersectionObserver" in window) || reducedMotion()) {
      showAll();
    } else {
      io = new IntersectionObserver(
        (entries) => {
          entries.forEach((e) => {
            if (e.isIntersecting) {
              e.target.classList.add("is-in");
              io?.unobserve(e.target);
            }
          });
        },
        { threshold: 0.12 },
      );
      els.forEach((el) => io!.observe(el));
      // a page that fits the viewport never scrolls anything into view
      t = setTimeout(() => {
        const sc = document.querySelector<HTMLElement>("[data-scroller]") || document.scrollingElement!;
        if (sc.scrollHeight <= sc.clientHeight + 4) showAll();
      }, 400);
    }
    window.addEventListener("beforeprint", showAll);

    const scroller = document.querySelector<HTMLElement>("[data-scroller]");
    const onAnchor = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest?.('a[href^="#"]');
      if (!a || !scroller) return;
      const id = a.getAttribute("href")!.slice(1);
      const el = id && document.getElementById(id);
      if (!el) return;
      e.preventDefault();
      const top = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 16;
      scroller.scrollTo({ top, behavior: reducedMotion() ? "auto" : "smooth" });
      history.replaceState(null, "", "#" + id);
    };
    const onKey = (e: KeyboardEvent) => {
      const tag = ((e.target as HTMLElement)?.tagName || "").toLowerCase();
      if (e.key !== "/" || tag === "input" || tag === "textarea") return;
      const s = document.querySelector<HTMLElement>("[data-search]");
      if (s && s.offsetParent) {
        e.preventDefault();
        s.focus();
      }
    };
    document.addEventListener("click", onAnchor);
    document.addEventListener("keydown", onKey);
    return () => {
      io?.disconnect();
      clearTimeout(t);
      window.removeEventListener("beforeprint", showAll);
      document.removeEventListener("click", onAnchor);
      document.removeEventListener("keydown", onKey);
    };
  }, []);
  return null;
}
