"use client";

import { useState } from "react";
import FaqView from "./views/FaqView";
import { flag, swap, type B, type K } from "./bind";

/** Accordion: at most one answer open; the first starts open. */
export default function Faq() {
  const [open, setOpen] = useState(0);

  const b: B = (key, i, base) => {
    const on = i === open;
    switch (key) {
      case "faq-q":
        return {
          className: flag(base, "pb-2.5", on),
          "aria-expanded": on ? "true" : "false",
          onClick: () => setOpen((o) => (o === i ? -1 : i)),
        };
      case "faq-bar":
        return { className: flag(base, "rotate-90", on) };
      case "faq-a": {
        let c = on ? swap(base, "grid-rows-[0fr]", "grid-rows-[1fr]") : swap(base, "grid-rows-[1fr]", "grid-rows-[0fr]");
        c = on ? swap(c, "opacity-0", "opacity-100") : swap(c, "opacity-100", "opacity-0");
        return { className: c, "aria-hidden": on ? "false" : "true" };
      }
    }
    return { className: base };
  };
  const k: K = () => null;

  return <FaqView b={b} k={k} />;
}
