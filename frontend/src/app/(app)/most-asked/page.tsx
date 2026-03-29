"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppPageShell } from "@/components/AppPageShell";
import { Card, CardContent } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { TrendingUp, LogIn, MessageSquarePlus } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useChat } from "@/contexts/ChatContext";
import { API_BASE, fetchWithRetry } from "@/lib/httpClient";
import { cn } from "@/lib/utils";

const FETCH_LIMIT = 50;

export default function MostAskedPage() {
  const router = useRouter();
  const { user, getAccessToken } = useAuth();
  const { requestComposerQuery } = useChat();
  const [rows, setRows] = useState<{ question: string; ask_count: number }[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!user) {
      setRows([]);
      return;
    }
    const token = getAccessToken();
    if (!token) return;
    let cancelled = false;
    setLoading(true);
    fetchWithRetry(
      `${API_BASE}/conversations/frequent-questions?limit=${FETCH_LIMIT}`,
      { headers: { Authorization: `Bearer ${token}` } },
      { logLabel: "GET /conversations/frequent-questions" }
    )
      .then(async (res) => {
        if (cancelled || !res.ok) return;
        const data = (await res.json()) as {
          questions?: { question?: string; ask_count?: number }[];
        };
        const raw = data.questions ?? [];
        const next = raw
          .map((row) => ({
            question: (row.question ?? "").trim(),
            ask_count: Number(row.ask_count) || 0,
          }))
          .filter((row) => row.question.length > 0);
        setRows(next);
      })
      .catch(() => {
        if (!cancelled) setRows([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user, getAccessToken]);

  const openQuestionInChat = (question: string) => {
    router.push("/");
    requestComposerQuery(question);
  };

  return (
    <AppPageShell
      title="Most Asked"
      description="Questions you’ve run most often — open one to continue in chat."
      bodyClassName="space-y-4"
    >
      {!user ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <TrendingUp className="mb-4 size-12 text-muted-foreground/50" aria-hidden />
            <p className="text-[13px] font-medium text-foreground">Sign in to see your top questions</p>
            <p className="mt-1 max-w-sm text-center text-[13px] text-muted-foreground">
              Frequent questions are derived from your saved chat history.
            </p>
            <Link href="/login">
              <Button className="mt-4 gap-2">
                <LogIn className="size-4" aria-hidden />
                Sign in
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : loading ? (
        <p className="text-[13px] text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <MessageSquarePlus className="mb-4 size-12 text-muted-foreground/50" aria-hidden />
            <p className="text-[13px] font-medium text-foreground">No frequent questions yet</p>
            <p className="mt-1 text-center text-[13px] text-muted-foreground">
              Ask a few questions in chat — your most repeated ones will show up here.
            </p>
            <Link
              href="/"
              className={cn(buttonVariants({ variant: "outline" }), "mt-4 inline-flex")}
            >
              New chat
            </Link>
          </CardContent>
        </Card>
      ) : (
        <>
          <p className="text-[12px] font-medium text-muted-foreground">
            {rows.length} question{rows.length !== 1 ? "s" : ""}
          </p>
          <ul className="space-y-2">
            {rows.map((item, i) => (
              <li key={`${item.question}-${i}`}>
                <Card
                  className={cn(
                    "transition-colors duration-200",
                    "hover:border-primary/25 hover:bg-accent/30"
                  )}
                >
                  <CardContent className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium leading-snug text-foreground">
                        {item.question}
                      </p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        Asked {item.ask_count} time{item.ask_count !== 1 ? "s" : ""}
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      className="shrink-0 rounded-lg"
                      onClick={() => openQuestionInChat(item.question)}
                    >
                      Use in chat
                    </Button>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        </>
      )}
    </AppPageShell>
  );
}
