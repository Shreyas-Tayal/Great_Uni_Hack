export const gbp = (n: number | null | undefined, dp = 0) =>
  n == null ? "–" : new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: dp, minimumFractionDigits: dp }).format(n);

export const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

/** 0.34 -> "3 in 10": easier to grasp than percentages for most people */
export const inTen = (p: number) => `${Math.round(p * 10)} in 10`;

export const kpiValue = (v: number | null, unit: string) =>
  unit === "GBP" ? gbp(v) : unit === "weeks" ? (v == null ? "Positive" : `${v} weeks`) : String(v ?? "–");
