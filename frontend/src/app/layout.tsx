import type { Metadata } from "next";
import "./globals.css";

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
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
