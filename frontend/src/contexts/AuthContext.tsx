"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
} from "react";

import { API_BASE, fetchWithRetry } from "@/lib/httpClient";

interface User {
  id: string;
  email: string;
  name?: string;
}

interface SignUpResult {
  requiresConfirmation?: boolean;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, name?: string) => Promise<SignUpResult>;
  signOut: () => void;
  getAccessToken: () => string | null;
  /** Exchange refresh_token for a new access_token; updates localStorage and user. */
  refreshAccessToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const TOKEN_KEY = "datapilot_access_token";
const REFRESH_KEY = "datapilot_refresh_token";
const USER_KEY = "datapilot_user";

function mapAuthFetchError(err: unknown): Error {
  const msg = err instanceof Error ? err.message : String(err);
  const isNetwork =
    msg === "Failed to fetch" ||
    msg === "Load failed" ||
    msg.includes("NetworkError") ||
    err instanceof TypeError;
  if (isNetwork) {
    return new Error(
      `Cannot reach the API at ${API_BASE}. Start the backend (from the backend folder: ` +
        `python -m uvicorn main:app --reload), or set NEXT_PUBLIC_API_URL in the repo-root .env ` +
        `or frontend/.env.local if the API is not on this host/port.`
    );
  }
  return err instanceof Error ? err : new Error(msg);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const getAccessToken = useCallback(() => {
    if (typeof window === "undefined") return null;
    return localStorage.getItem(TOKEN_KEY);
  }, []);

  const clearSession = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_KEY);
    localStorage.removeItem(USER_KEY);
    setUser(null);
  }, []);

  const persistSession = useCallback(
    (accessToken: string, refreshToken: string | null | undefined, userData: User) => {
      localStorage.setItem(TOKEN_KEY, accessToken);
      if (refreshToken) localStorage.setItem(REFRESH_KEY, refreshToken);
      localStorage.setItem(USER_KEY, JSON.stringify(userData));
      setUser(userData);
    },
    []
  );

  const refreshAccessToken = useCallback(async (): Promise<string | null> => {
    if (typeof window === "undefined") return null;
    const refreshToken = localStorage.getItem(REFRESH_KEY);
    if (!refreshToken) return null;
    try {
      const refreshRes = await fetchWithRetry(
        `${API_BASE}/auth/refresh`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refresh_token: refreshToken }),
        },
        { logLabel: "POST /auth/refresh (refreshAccessToken)", retriableStatuses: [] }
      );
      const refreshData = await refreshRes.json().catch(() => ({}));
      if (!refreshRes.ok || !refreshData.access_token || !refreshData.user) {
        if (refreshRes.status === 401 || refreshRes.status === 403) {
          clearSession();
        }
        return null;
      }
      persistSession(
        refreshData.access_token,
        refreshData.refresh_token ?? refreshToken,
        refreshData.user as User
      );
      return refreshData.access_token as string;
    } catch {
      return null;
    }
  }, [clearSession, persistSession]);

  const loadUser = useCallback(async () => {
    const token = getAccessToken();
    if (!token) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const res = await fetchWithRetry(
        `${API_BASE}/auth/me`,
        { headers: { Authorization: `Bearer ${token}` } },
        { logLabel: "GET /auth/me" }
      );
      const data = await res.json();
      if (data?.user) {
        setUser(data.user);
        setLoading(false);
        return;
      }

      const refreshToken = localStorage.getItem(REFRESH_KEY);
      if (!refreshToken) {
        clearSession();
        setLoading(false);
        return;
      }

      const refreshRes = await fetchWithRetry(
        `${API_BASE}/auth/refresh`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refresh_token: refreshToken }),
        },
        { retriableStatuses: [], logLabel: "POST /auth/refresh" }
      );
      const refreshData = await refreshRes.json().catch(() => ({}));
      if (
        !refreshRes.ok ||
        !refreshData.access_token ||
        !refreshData.user
      ) {
        clearSession();
        setLoading(false);
        return;
      }

      persistSession(
        refreshData.access_token,
        refreshData.refresh_token ?? refreshToken,
        refreshData.user as User
      );
    } catch {
      clearSession();
    } finally {
      setLoading(false);
    }
  }, [getAccessToken, clearSession, persistSession]);

  useEffect(() => {
    loadUser();
  }, [loadUser]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      try {
        const res = await fetchWithRetry(
          `${API_BASE}/auth/login`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password }),
          },
          { retriableStatuses: [], logLabel: "POST /auth/login" }
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(
            typeof data?.detail === "string" ? data.detail : "Login failed"
          );
        }
        const token = data.access_token;
        const userData = data.user;
        if (token && userData) {
          persistSession(token, data.refresh_token, userData);
        }
      } catch (err) {
        throw mapAuthFetchError(err);
      }
    },
    [persistSession]
  );

  const signUp = useCallback(
    async (email: string, password: string, name?: string): Promise<SignUpResult> => {
      try {
        const res = await fetchWithRetry(
          `${API_BASE}/auth/signup`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password, name: name || undefined }),
          },
          { retriableStatuses: [], logLabel: "POST /auth/signup" }
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(
            typeof data?.detail === "string" ? data.detail : "Sign up failed"
          );
        }
        const token = data.access_token;
        const userData = data.user;
        const requiresConfirmation = data.requires_confirmation === true;
        if (token && userData && !requiresConfirmation) {
          persistSession(token, data.refresh_token, userData);
        }
        return { requiresConfirmation: requiresConfirmation || undefined };
      } catch (err) {
        throw mapAuthFetchError(err);
      }
    },
    [persistSession]
  );

  const signOut = useCallback(() => {
    clearSession();
  }, [clearSession]);

  return (
    <AuthContext.Provider
      value={{ user, loading, signIn, signUp, signOut, getAccessToken, refreshAccessToken }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (ctx === undefined) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}
