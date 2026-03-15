"use client";

import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MessageSquare } from "lucide-react";
import { useChat } from "@/contexts/ChatContext";
import { cn } from "@/lib/utils";

export default function ChatsPage() {
  const router = useRouter();
  const { conversations, currentConversationId, loadConversation } = useChat();

  const handleSelectChat = (convId: string) => {
    loadConversation(convId);
    router.push("/");
  };

  return (
    <div className="flex flex-col min-h-screen">
      <header className="shrink-0 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto max-w-4xl px-6 py-6">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
            Chat History
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            View and continue your previous conversations.
          </p>
        </div>
      </header>
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-4xl px-6 py-6 space-y-6">
          <h2 className="text-sm font-medium text-muted-foreground">
            {conversations.length} conversation{conversations.length !== 1 ? "s" : ""}
          </h2>

          {conversations.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-16">
                <MessageSquare className="size-12 text-muted-foreground/50 mb-4" aria-hidden />
                <p className="text-sm font-medium text-foreground">No conversations yet</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Start a new chat to ask questions about your data.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {conversations.map((conv) => (
                <Card
                  key={conv.id}
                  className={cn(
                    "transition-colors duration-200 cursor-pointer",
                    currentConversationId === conv.id
                      ? "border-primary bg-primary/5"
                      : "hover:border-primary/20"
                  )}
                  onClick={() => handleSelectChat(conv.id)}
                >
                  <CardHeader className="flex flex-row items-center gap-3 space-y-0 pb-2">
                    <div className="size-10 flex items-center justify-center rounded-lg bg-muted">
                      <MessageSquare className="size-5 text-muted-foreground" aria-hidden />
                    </div>
                    <div className="flex-1 min-w-0">
                      <CardTitle className="text-base font-medium truncate">
                        {conv.title || "Untitled"}
                      </CardTitle>
                      <CardDescription>
                        {new Date(conv.updated_at).toLocaleDateString(undefined, {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </CardDescription>
                    </div>
                  </CardHeader>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
