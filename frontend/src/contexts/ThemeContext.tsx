"use client";

import { ThemeProvider as NextThemesProvider, useTheme as useNextTheme } from "next-themes";

export type ThemeChoice = "light" | "dark";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="light"
      enableSystem={false}
      storageKey="datapilot_theme"
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}

export function useTheme() {
  const { theme, setTheme, resolvedTheme } = useNextTheme();
  const current = (resolvedTheme ?? theme ?? "light") as ThemeChoice;

  return {
    theme: current,
    setTheme: (t: ThemeChoice) => setTheme(t),
    toggleTheme: () => setTheme(current === "dark" ? "light" : "dark"),
  };
}
