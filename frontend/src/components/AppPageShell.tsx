"use client";

import { useEffect } from "react";
import { cn } from "@/lib/utils";
import { useAppMainHeader } from "@/contexts/AppMainHeaderContext";

type AppPageShellProps = {
  title: string;
  description?: string;
  children: React.ReactNode;
  bodyClassName?: string;
};

export function AppPageShell({
  title,
  description,
  children,
  bodyClassName,
}: AppPageShellProps) {
  const { setMainHeader } = useAppMainHeader();

  useEffect(() => {
    setMainHeader({ title, description });
    return () => setMainHeader(null);
  }, [title, description, setMainHeader]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
          data-scrollbar
        >
          <div
            className={cn(
              "mx-auto max-w-4xl px-4 pb-2 pt-3 sm:px-6 sm:pb-3 sm:pt-4",
              bodyClassName
            )}
          >
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
