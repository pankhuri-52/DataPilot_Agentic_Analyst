"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  ReactNode,
} from "react";
import { useAuth } from "@/contexts/AuthContext";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export interface Conversation {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  content?: string;
  loading?: boolean;
  error?: string;
  plan?: Record<string, unknown>;
  liveTrace?: { agent: string; status: string; message?: string; output?: Record<string, unknown> }[];
  response?: Record<string, unknown>;
}

interface ChatContextType {
  conversations: Conversation[];
  currentConversationId: string | null;
  messages: Message[];
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  setCurrentConversationId: (id: string | null) => void;
  fetchConversations: () => Promise<void>;
  loadConversation: (convId: string) => Promise<void>;
  startNewChat: () => void;
}

const ChatContext = createContext<ChatContextType | undefined>(undefined);

export function ChatProvider({ children }: { children: ReactNode }) {
  const { user, getAccessToken } = useAuth();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConversationId, setCurrentConversationIdState] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);

  const fetchConversations = useCallback(async () => {
    const token = getAccessToken();
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/conversations`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setConversations(data.conversations || []);
      }
    } catch {
      // Ignore
    }
  }, [getAccessToken]);

  useEffect(() => {
    if (user) {
      fetchConversations();
    } else {
      setConversations([]);
      setCurrentConversationIdState(null);
      setMessages([]);
    }
  }, [user, fetchConversations]);

  const loadConversation = useCallback(
    async (convId: string) => {
      const token = getAccessToken();
      if (!token) return;
      try {
        const res = await fetch(`${API_BASE}/conversations/${convId}/messages`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          const msgs = (data.messages || []) as {
            role: string;
            content: string;
            metadata?: Record<string, unknown>;
          }[];
          setMessages(
            msgs.map((m) => {
              const meta = m.metadata || {};
              const response =
                m.role === "assistant"
                  ? ({ ...meta, explanation: m.content } as Record<string, unknown>)
                  : undefined;
              return {
                id: crypto.randomUUID(),
                role: m.role as "user" | "assistant",
                content: m.content,
                response,
              };
            })
          );
          setCurrentConversationIdState(convId);
        }
      } catch {
        // Ignore
      }
    },
    [getAccessToken]
  );

  const startNewChat = useCallback(() => {
    setCurrentConversationIdState(null);
    setMessages([]);
  }, []);

  const setCurrentConversationId = useCallback((id: string | null) => {
    setCurrentConversationIdState(id);
  }, []);

  return (
    <ChatContext.Provider
      value={{
        conversations,
        currentConversationId,
        messages,
        setMessages,
        setCurrentConversationId,
        fetchConversations,
        loadConversation,
        startNewChat,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
}

export function useChat() {
  const ctx = useContext(ChatContext);
  if (ctx === undefined) {
    throw new Error("useChat must be used within ChatProvider");
  }
  return ctx;
}
