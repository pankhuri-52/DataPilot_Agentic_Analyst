"use client";

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type AppMainHeaderPayload = {
  title: string;
  description?: string;
};

type AppMainHeaderContextValue = {
  mainHeader: AppMainHeaderPayload | null;
  setMainHeader: (value: AppMainHeaderPayload | null) => void;
};

const AppMainHeaderContext = createContext<AppMainHeaderContextValue | null>(
  null
);

export function AppMainHeaderProvider({ children }: { children: ReactNode }) {
  const [mainHeader, setMainHeader] = useState<AppMainHeaderPayload | null>(
    null
  );
  const value = useMemo(
    () => ({ mainHeader, setMainHeader }),
    [mainHeader]
  );
  return (
    <AppMainHeaderContext.Provider value={value}>
      {children}
    </AppMainHeaderContext.Provider>
  );
}

export function useAppMainHeader() {
  const ctx = useContext(AppMainHeaderContext);
  if (!ctx) {
    throw new Error("useAppMainHeader must be used within AppMainHeaderProvider");
  }
  return ctx;
}
