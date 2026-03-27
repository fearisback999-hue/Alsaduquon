import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "NeoPOD — Automated POD Engine",
  description: "AI-powered print-on-demand automation with listing validation and profit optimization",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans">{children}</body>
    </html>
  );
}
