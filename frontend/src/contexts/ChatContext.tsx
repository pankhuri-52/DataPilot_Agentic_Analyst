"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  ReactNode,
} from "react";
import { useAuth } from "@/contexts/AuthContext";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

/** Messages when no Supabase conversation is selected (signed-out or new chat). */
export const GUEST_MESSAGES_KEY = "__guest__";

export function conversationMessagesKey(conversationId: string | null): string {
  return conversationId ?? GUEST_MESSAGES_KEY;
}

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
  pendingInterrupt?: {
    reason: string;
    data: Record<string, unknown>;
    thread_id: string;
    trace?: unknown[];
    plan?: Record<string, unknown>;
    tables_used?: string[];
    sql?: string;
    bytes_scanned?: number;
    estimated_cost?: number;
  };
  threadId?: string;
  /** Supabase conversation this turn belongs to (for /ask/continue and patchMessages routing). */
  conversationId?: string;
}

async function parseErrorDetail(res: Response): Promise<string> {
  try {
    const data = await res.json();
    const d = data?.detail;
    if (typeof d === "string") return d;
    if (Array.isArray(d)) return d.map((x: { msg?: string }) => x.msg || String(x)).join("; ");
    return `Request failed (${res.status})`;
  } catch {
    return `Request failed (${res.status})`;
  }
}

interface ChatContextType {
  conversations: Conversation[];
  currentConversationId: string | null;
  messages: Message[];
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  patchMessages: (convKey: string, updater: React.SetStateAction<Message[]>) => void;
  getMessagesForKey: (convKey: string) => Message[];
  setCurrentConversationId: (id: string | null) => void;
  fetchConversations: () => Promise<void>;
  loadConversation: (convId: string) => Promise<void>;
  startNewChat: () => void;
  conversationsError: string | null;
  clearConversationsError: () => void;
  upsertConversation: (conv: Conversation) => void;
}

const ChatContext = createContext<ChatContextType | undefined>(undefined);

export function ChatProvider({ children }: { children: ReactNode }) {
  const { user, getAccessToken } = useAuth();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConversationId, setCurrentConversationIdState] = useState<string | null>(null);
  const [messagesByConv, setMessagesByConv] = useState<Record<string, Message[]>>({});
  const [conversationsError, setConversationsError] = useState<string | null>(null);

  const messagesByConvRef = useRef(messagesByConv);
  messagesByConvRef.current = messagesByConv;

  const messages = useMemo(
    () => messagesByConv[conversationMessagesKey(currentConversationId)] ?? [],
    [messagesByConv, currentConversationId]
  );

  const clearConversationsError = useCallback(() => setConversationsError(null), []);

  const patchMessages = useCallback((convKey: string, updater: React.SetStateAction<Message[]>) => {
    setMessagesByConv((prev) => {
      const cur = prev[convKey] ?? [];
      const next = typeof updater === "function" ? (updater as (p: Message[]) => Message[])(cur) : updater;
      return { ...prev, [convKey]: next };
    });
  }, []);

  const getMessagesForKey = useCallback((convKey: string) => messagesByConvRef.current[convKey] ?? [], []);

  const setMessages = useCallback(
    (updater: React.SetStateAction<Message[]>) => {
      const key = conversationMessagesKey(currentConversationId);
      patchMessages(key, updater);
    },
    [currentConversationId, patchMessages]
  );

  const upsertConversation = useCallback((conv: Conversation) => {
    setConversations((prev) => {
      const rest = prev.filter((x) => x.id !== conv.id);
      return [conv, ...rest];
    });
    setConversationsError(null);
  }, []);

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
        setConversationsError(null);
      } else {
        setConversationsError(await parseErrorDetail(res));
      }
    } catch (e) {
      setConversationsError(e instanceof Error ? e.message : "Failed to load conversations");
    }
  }, [getAccessToken]);

  useEffect(() => {
    if (user) {
      fetchConversations();
    } else {
      setConversations([]);
      setCurrentConversationIdState(null);
      setMessagesByConv({});
      setConversationsError(null);
    }
  }, [user, fetchConversations]);

  const loadConversation = useCallback(
    async (convId: string) => {
      if (convId === currentConversationId) return;
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
          const mapped = msgs.map((m) => {
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
              conversationId: convId,
            };
          });
          setMessagesByConv((prev) => ({ ...prev, [convId]: mapped }));
          setCurrentConversationIdState(convId);
          setConversationsError(null);
        } else {
          setConversationsError(await parseErrorDetail(res));
        }
      } catch (e) {
        setConversationsError(e instanceof Error ? e.message : "Failed to load messages");
      }
    },
    [getAccessToken, currentConversationId]
  );

  const startNewChat = useCallback(() => {
    setCurrentConversationIdState(null);
    setMessagesByConv((prev) => ({ ...prev, [GUEST_MESSAGES_KEY]: [] }));
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
        patchMessages,
        getMessagesForKey,
        setCurrentConversationId,
        fetchConversations,
        loadConversation,
        startNewChat,
        conversationsError,
        clearConversationsError,
        upsertConversation,
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
