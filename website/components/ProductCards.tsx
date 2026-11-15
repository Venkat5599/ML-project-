"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ProductCardsView from "./views/ProductCardsView";
import { reducedMotion, type B, type K } from "./bind";

/** Component cards: a scroll-snapped row stepped one card at a time by the arrow buttons. */
export default function ProductCards() {
  const ul = useRef<HTMLUListElement | null>(null);
  const [edge, setEdge] = useState({ prev: true, next: false });

  const edges = useCallback(() => {
    const u = ul.current;
    if (!u) return;
    const max = u.scrollWidth - u.clientWidth;
    setEdge({ prev: u.scrollLeft <= 2, next: u.scrollLeft >= max - 2 });
  }, []);

  useEffect(() => {
    edges();
    window.addEventListener("resize", edges);
    return () => window.removeEventListener("resize", edges);
  }, [edges]);

  const step = (dir: number) => {
    const u = ul.current;
    const li = u?.children[0] as HTMLElement | undefined;
    if (!u || !li) return;
    const gap = parseFloat(getComputedStyle(u).columnGap) || 24;
    u.scrollBy({ left: dir * (li.getBoundingClientRect().width + gap), behavior: reducedMotion() ? "auto" : "smooth" });
  };

  const b: B = (key, _i, base) => {
    switch (key) {
      case "cards":
        return { className: base, ref: ul, onScroll: edges };
      case "cards-prev":
        return { className: base, disabled: edge.prev, onClick: () => step(-1) };
      case "cards-next":
        return { className: base, disabled: edge.next, onClick: () => step(1) };
    }
    return { className: base };
  };
  const k: K = () => null;

  return <ProductCardsView b={b} k={k} />;
}
