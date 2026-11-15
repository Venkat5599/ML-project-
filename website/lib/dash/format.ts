const DT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" });

export const fmtTime = (ms: number) => `${DT.format(new Date(ms))} UTC`;
export const fmt3 = (x: number | null | undefined) => (x == null ? "–" : x.toFixed(3));
export const fmtInt = (n: number) => n.toLocaleString("en-US");
export const pct = (x: number, d = 0) => `${(x * 100).toFixed(d)}%`;
