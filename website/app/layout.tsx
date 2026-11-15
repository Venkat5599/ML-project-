import type { Metadata } from "next";
import type React from "react";

export const metadata: Metadata = {
  title: "ChainSleuth AML | Temporal, graph-aware money-laundering detection",
  description: "Leakage-safe AML detection on the Elliptic Bitcoin dataset: 203,769 transactions, temporal evaluation, XGBoost, GraphSAGE and a calibrated hybrid ensemble with SHAP explanations.",
  icons: { icon: { url: "/assets/cs/favicon.svg", type: "image/svg+xml" } },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="L7RCgW_variable -chvsa_variable Ho1HtG_variable htlnMG_variable sFVbzW_variable oLVb-W_variable _18MbXW_variable hcAbxW_variable">
      <body>{children}</body>
    </html>
  );
}
