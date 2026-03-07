import { DataPilotClient } from "@/components/DataPilotClient";

export default function Home() {
  return (
    <main className="min-h-screen p-8 max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground">DataPilot</h1>
        <p className="mt-2 text-muted-foreground">
          Autonomous multi-agent analytics – turn questions into validated
          insights.
        </p>
      </div>
      <DataPilotClient />
    </main>
  );
}
