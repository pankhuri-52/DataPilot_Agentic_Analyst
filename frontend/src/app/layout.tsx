import type { Metadata } from "next";
import "./globals.css";
import { Plus_Jakarta_Sans, Lora, Roboto_Mono } from "next/font/google";
import { cn } from "@/lib/utils";
import { AuthProvider } from "@/contexts/AuthContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const lora = Lora({
  subsets: ["latin"],
  variable: "--font-serif",
  display: "swap",
});

const robotoMono = Roboto_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
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
    <html
      lang="en"
      className={cn("font-sans", plusJakarta.variable, lora.variable, robotoMono.variable)}
      suppressHydrationWarning
    >
      <body className="antialiased min-h-screen bg-background text-[15px] leading-normal">
        <ThemeProvider>
          <AuthProvider>
            <TooltipProvider delay={300}>
              {children}
            </TooltipProvider>
          </AuthProvider>
          <Toaster richColors position="bottom-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}
