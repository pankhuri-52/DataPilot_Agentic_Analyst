import { DataPilotClient } from "@/components/DataPilotClient";

export default function Home() {
  return (
    <div className="flex flex-col min-h-screen">
      <header className="shrink-0 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto max-w-4xl px-4 py-4 sm:px-6">
          <h1 className="font-display text-xl font-semibold tracking-tight text-foreground">
            Ask about your data
          </h1>
          <p className="mt-0.5 text-xs text-muted-foreground sm:text-sm">
            Connect data sources, then ask questions to get validated insights.
          </p>
        </div>
      </header>
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-4xl px-4 py-4 sm:px-6 sm:py-5">
          <DataPilotClient />
        </div>
      </div>
    </div>
  );
}
