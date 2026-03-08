"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Plus, Database, FileSpreadsheet, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface DataSource {
  id: string;
  name: string;
  type: "bigquery" | "csv" | "postgres";
  status: "connected" | "pending" | "error";
  lastSynced?: string;
}

const MOCK_SOURCES: DataSource[] = [
  {
    id: "1",
    name: "Retail Analytics",
    type: "bigquery",
    status: "connected",
    lastSynced: "2 hours ago",
  },
  {
    id: "2",
    name: "Sales Export Q1",
    type: "csv",
    status: "connected",
    lastSynced: "1 day ago",
  },
];

const typeLabels: Record<string, string> = {
  bigquery: "BigQuery",
  csv: "CSV",
  postgres: "PostgreSQL",
};

const typeIcons: Record<string, React.ElementType> = {
  bigquery: Database,
  csv: FileSpreadsheet,
  postgres: Database,
};

export default function SourcesPage() {
  const [sources, setSources] = useState<DataSource[]>(MOCK_SOURCES);
  const [showAddForm, setShowAddForm] = useState(false);

  const addSource = () => {
    setShowAddForm(true);
  };

  const removeSource = (id: string) => {
    setSources((prev) => prev.filter((s) => s.id !== id));
  };

  return (
    <div className="flex flex-col min-h-screen">
      <header className="shrink-0 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto max-w-4xl px-6 py-6">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
            Data Sources
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Connect and manage your data sources for analytics.
          </p>
        </div>
      </header>
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-4xl px-6 py-6 space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-muted-foreground">
              {sources.length} source{sources.length !== 1 ? "s" : ""} connected
            </h2>
            <Button
              onClick={addSource}
              className="cursor-pointer"
              size="sm"
            >
              <Plus className="size-4 mr-2" aria-hidden />
              Add source
            </Button>
          </div>

          {sources.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-16">
                <Database className="size-12 text-muted-foreground/50 mb-4" aria-hidden />
                <p className="text-sm font-medium text-foreground">No data sources yet</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Connect your first data source to start asking questions.
                </p>
                <Button
                  onClick={addSource}
                  variant="outline"
                  className="mt-2 cursor-pointer"
                >
                  <Plus className="size-4 mr-2" aria-hidden />
                  Add data source
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {sources.map((source) => {
                const Icon = typeIcons[source.type];
                return (
                  <Card
                    key={source.id}
                    className="transition-colors duration-200 hover:border-primary/20 cursor-pointer"
                  >
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                      <div className="flex items-center gap-3">
                        <div className="flex size-10 items-center justify-center rounded-lg bg-muted">
                          <Icon className="size-5 text-muted-foreground" aria-hidden />
                        </div>
                        <div>
                          <CardTitle className="text-base font-medium">
                            {source.name}
                          </CardTitle>
                          <CardDescription>
                            {typeLabels[source.type]}
                            {source.lastSynced && (
                              <span className="ml-2">· {source.lastSynced}</span>
                            )}
                          </CardDescription>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
                            source.status === "connected" &&
                              "bg-primary/10 text-primary",
                            source.status === "pending" &&
                              "bg-primary/5 text-muted-foreground",
                            source.status === "error" &&
                              "bg-destructive/10 text-destructive"
                          )}
                        >
                          {source.status}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-9 shrink-0 cursor-pointer text-muted-foreground hover:text-destructive"
                          onClick={() => removeSource(source.id)}
                          aria-label={`Remove ${source.name}`}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </CardHeader>
                  </Card>
                );
              })}
            </div>
          )}

          {showAddForm && (
            <Card className="animate-in fade-in slide-up duration-200">
              <CardHeader>
                <CardTitle>Add data source</CardTitle>
                <CardDescription>
                  Connect a new data source (UI only – no backend connection yet).
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <label htmlFor="source-name" className="text-sm font-medium">
                    Name
                  </label>
                  <Input
                    id="source-name"
                    placeholder="e.g. Marketing Data"
                    disabled
                    className="opacity-60"
                  />
                </div>
                <div className="space-y-2">
                  <label htmlFor="source-type" className="text-sm font-medium">
                    Type
                  </label>
                  <Input
                    id="source-type"
                    placeholder="BigQuery, CSV, PostgreSQL..."
                    disabled
                    className="opacity-60"
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setShowAddForm(false)}
                    className="cursor-pointer"
                  >
                    Cancel
                  </Button>
                  <Button disabled className="opacity-60 cursor-not-allowed">
                    Connect (coming soon)
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
