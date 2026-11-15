"use client";

import { useEffect } from "react";
import { useDash } from "@/lib/dash/store";

/** Loads the saved mock session after hydration, so the static HTML and first render match. */
export function Rehydrate() {
  useEffect(() => {
    void useDash.persist.rehydrate();
  }, []);
  return null;
}
