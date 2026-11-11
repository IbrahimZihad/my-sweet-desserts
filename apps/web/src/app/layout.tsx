import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "CakeFlow — order a celebration cake",
    template: "%s · CakeFlow",
  },
  description:
    "Reserve a pickup window and pay your deposit online. Small-batch celebration cakes, baked locally.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-AU">
      <body>{children}</body>
    </html>
  );
}
