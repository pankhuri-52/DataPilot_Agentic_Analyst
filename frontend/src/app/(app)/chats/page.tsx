"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppPageShell } from "@/components/AppPageShell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MessageSquare, LogIn } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { CONVERSATIONS_UI_MAX, useChat } from "@/contexts/ChatContext";
import { cn } from "@/lib/utils";

export default function ChatsPage() {
  const router = useRouter();
  const { user } = useAuth();
  const {
    conversations,
    conversationsTotal,
    currentConversationId,
    loadConversation,
  } = useChat();

  const handleSelectChat = (convId: string) => {
    loadConversation(convId);
    router.push("/");
  };

  return (
    <AppPageShell
      title="Chats"
      description="Open a chat to continue on the home screen."
      bodyClassName="space-y-6"
    >
      {!user ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <LogIn className="mb-4 size-12 text-muted-foreground/50" aria-hidden />
            <p className="text-sm font-medium text-foreground">Sign in to view your chat history</p>
            <p className="mt-1 max-w-sm text-center text-sm text-muted-foreground">
              Chat history is saved only when you are signed in. Sign in to see and continue your
              previous conversations.
            </p>
            <Link href="/login">
              <Button className="mt-4">Sign in</Button>
            </Link>
          </CardContent>
        </Card>
      ) : conversations.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <MessageSquare className="mb-4 size-12 text-muted-foreground/50" aria-hidden />
            <p className="text-sm font-medium text-foreground">No conversations yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Start a new chat to ask questions about your data. Your conversations will appear
              here.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="space-y-1">
            <h2 className="text-sm font-medium text-muted-foreground">
              {conversationsTotal} conversation{conversationsTotal !== 1 ? "s" : ""}
            </h2>
            {conversationsTotal > CONVERSATIONS_UI_MAX && (
              <p className="text-xs text-muted-foreground/90">
                Showing your {CONVERSATIONS_UI_MAX} most recent chats. Older ones are still stored but
                not listed here.
              </p>
            )}
          </div>
          <div className="space-y-4">
            {conversations.map((conv) => (
              <Card
                key={conv.id}
                className={cn(
                  "cursor-pointer transition-colors duration-200",
                  currentConversationId === conv.id
                    ? "border-primary bg-primary/5"
                    : "hover:border-primary/20"
                )}
                onClick={() => handleSelectChat(conv.id)}
              >
                <CardHeader className="flex flex-row items-center gap-3 space-y-0 pb-2">
                  <div className="flex size-10 items-center justify-center rounded-lg bg-muted">
                    <MessageSquare className="size-5 text-muted-foreground" aria-hidden />
                  </div>
                  <div className="min-w-0 flex-1">
                    <CardTitle className="truncate text-base font-medium">
                      {conv.title || "Untitled"}
                    </CardTitle>
                    <CardDescription>
                      {(() => {
                        const d = new Date(conv.updated_at);
                        if (Number.isNaN(d.getTime())) return "—";
                        return d.toLocaleString(undefined, {
                          dateStyle: "medium",
                          timeStyle: "short",
                        });
                      })()}
                    </CardDescription>
                  </div>
                </CardHeader>
              </Card>
            ))}
          </div>
        </>
      )}
    </AppPageShell>
  );
}
