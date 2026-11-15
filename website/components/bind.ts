import type React from "react";

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Props = Record<string, any>;
/** b(key, index, base classes) -> props spread onto a bound element of a generated view */
export type B = (key: string, i: number, base: string) => Props;
/** k(key, index) -> children for an element whose content is state-driven */
export type K = (key: string, i: number) => React.ReactNode;

/** Swap class `from` for `to`, keeping the token's original position (so the default state renders exactly as before). */
export function swap(base: string, from: string, to: string): string {
  const t = base.split(" ").filter(Boolean);
  const at = t.indexOf(from);
  if (at >= 0) t[at] = to;
  else if (!t.includes(to)) t.push(to);
  return t.join(" ");
}

/** Add or remove a single class. */
export function flag(base: string, cls: string, on: boolean): string {
  const t = base.split(" ").filter(Boolean).filter((c) => c !== cls);
  if (on) t.push(cls);
  return t.join(" ");
}

export function reducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
}
