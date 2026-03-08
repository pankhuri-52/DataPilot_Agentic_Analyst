import { DataPilotClient } from "@/components/DataPilotClient";

export default function Home() {
  return (
    <div className="flex flex-col min-h-screen">
      <header className="shrink-0 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto max-w-4xl px-6 py-6">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
            Ask about your data
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Connect data sources, then ask questions to get validated insights.
          </p>
        </div>
      </header>
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-4xl px-6 py-6">
          <DataPilotClient />
        </div>
      </div>
    </div>
  );
}
