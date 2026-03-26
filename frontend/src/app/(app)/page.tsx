import { AppPageShell } from "@/components/AppPageShell";
import { DataPilotClient } from "@/components/DataPilotClient";

export default function Home() {
  return (
    <AppPageShell
      title="Ask about your data"
      description="Connect data sources, then ask questions to get validated insights."
    >
      <DataPilotClient />
    </AppPageShell>
  );
}
