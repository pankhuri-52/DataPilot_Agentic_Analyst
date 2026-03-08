import type { Metadata } from "next";
import "./globals.css";
import { Fraunces, DM_Sans } from "next/font/google";
import { cn } from "@/lib/utils";
import { AppShell } from "@/components/AppShell";

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "DataPilot",
  description: "Autonomous multi-agent analytics – turn questions into validated insights.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={cn("font-sans", dmSans.variable, fraunces.variable)}>
      <body className="antialiased min-h-screen bg-background">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
