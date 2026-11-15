"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import HeroView from "./views/HeroView";
import { reducedMotion, swap, type B, type K } from "./bind";

const SLIDES = 4;
const DURATION = 6000;

/** Product-view carousel: one slide visible, the active dot's bar fills over 6s, then the next slide fades in. */
export default function Hero() {
  const [cur, setCur] = useState(0);
  const [run, setRun] = useState(0);
  const [inView, setInView] = useState(true);
  const [pageVisible, setPageVisible] = useState(true);
  const root = useRef<HTMLDivElement | null>(null);

  const go = useCallback((i: number) => {
    setCur(((i % SLIDES) + SLIDES) % SLIDES);
    setRun((r) => r + 1);
  }, []);

  useEffect(() => {
    const el = root.current;
    if (!el || !("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver((es) => setInView(es[0].isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const on = () => setPageVisible(!document.hidden);
    on();
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);

  // with reduced motion the bar never animates, so advance on a timer instead
  useEffect(() => {
    if (!reducedMotion()) return;
    const t = setInterval(() => setCur((c) => (c + 1) % SLIDES), DURATION);
    return () => clearInterval(t);
  }, []);

  const b: B = (key, i, base) => {
    switch (key) {
      case "hero-root":
        return { className: base, ref: root };
      case "hero-slide":
        return {
          className: i === cur ? swap(base, "opacity-0", "opacity-100") : swap(base, "opacity-100", "opacity-0"),
          "aria-hidden": i === cur ? "false" : "true",
        };
      case "hero-dot":
        return { className: base, "aria-current": i === cur ? "true" : "false", onClick: () => go(i) };
      case "hero-pill":
        return { className: i === cur ? swap(base, "w-1", "w-8.5") : swap(base, "w-8.5", "w-1") };
    }
    return { className: base };
  };

  const k: K = (key, i) =>
    key === "hero-pill" && i === cur ? (
      <span
        key={run}
        className="absolute inset-0 origin-left animate-[cs-slide-progress_linear] rounded-full bg-white motion-reduce:animate-none"
        style={{ animationDuration: `${DURATION}ms`, animationPlayState: inView && pageVisible ? "running" : "paused" }}
        onAnimationEnd={() => go(cur + 1)}
      />
    ) : null;

  return <HeroView b={b} k={k} />;
}
