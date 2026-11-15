"use client";

import React, { useEffect, useRef, useState } from "react";
import HeaderView from "./views/HeaderView";
import type { B, K } from "./bind";

/** Desktop + phone header: hover/click menus and the phone menu sheet. */
export default function Header() {
  const [menu, setMenu] = useState(-1);
  const [mobile, setMobile] = useState(false);
  const wraps = useRef<(HTMLDivElement | null)[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenu(-1);
        setMobile(false);
      }
    };
    const onClick = (e: MouseEvent) => {
      if (!wraps.current.some((w) => w && w.contains(e.target as Node))) setMenu(-1);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("click", onClick);
      clearTimeout(timer.current);
    };
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("menu-open", mobile);
  }, [mobile]);

  const b: B = (key, i, base) => {
    const cls = base || undefined;
    switch (key) {
      case "menu-wrap":
        return {
          className: cls,
          ref: (el: HTMLDivElement | null) => {
            wraps.current[i] = el;
          },
          onMouseEnter: () => {
            clearTimeout(timer.current);
            setMenu(i);
          },
          onMouseLeave: () => {
            timer.current = setTimeout(() => setMenu((m) => (m === i ? -1 : m)), 120);
          },
        };
      case "menu-btn":
        return {
          className: cls,
          "aria-expanded": menu === i ? "true" : "false",
          "data-state": menu === i ? "open" : "closed",
          onClick: () => setMenu((m) => (m === i ? -1 : i)),
        };
      case "menu-pop":
        return { className: cls, "data-state": menu === i ? "open" : "closed" };
      case "mobile-open":
        return { className: cls, "aria-expanded": mobile ? "true" : "false", onClick: () => setMobile((m) => !m) };
      case "mobile-panel":
        return {
          className: cls,
          "data-state": mobile ? "open" : "closed",
          onClick: (e: React.MouseEvent) => {
            if ((e.target as HTMLElement).closest("a")) setMobile(false);
          },
        };
    }
    return { className: cls };
  };
  const k: K = () => null;

  return <HeaderView b={b} k={k} />;
}
