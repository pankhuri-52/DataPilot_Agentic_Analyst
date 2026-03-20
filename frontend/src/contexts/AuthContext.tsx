"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
} from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

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
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const TOKEN_KEY = "datapilot_access_token";
const REFRESH_KEY = "datapilot_refresh_token";
const USER_KEY = "datapilot_user";

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

  const loadUser = useCallback(async () => {
    const token = getAccessToken();
    if (!token) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
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

      const refreshRes = await fetch(`${API_BASE}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
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
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || "Login failed");
      }
      const token = data.access_token;
      const userData = data.user;
      if (token && userData) {
        persistSession(token, data.refresh_token, userData);
      }
    },
    [persistSession]
  );

  const signUp = useCallback(
    async (email: string, password: string, name?: string): Promise<SignUpResult> => {
      const res = await fetch(`${API_BASE}/auth/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, name: name || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || "Sign up failed");
      }
      const token = data.access_token;
      const userData = data.user;
      const requiresConfirmation = data.requires_confirmation === true;
      if (token && userData && !requiresConfirmation) {
        persistSession(token, data.refresh_token, userData);
      }
      return { requiresConfirmation: requiresConfirmation || undefined };
    },
    [persistSession]
  );

  const signOut = useCallback(() => {
    clearSession();
  }, [clearSession]);

  return (
    <AuthContext.Provider
      value={{ user, loading, signIn, signUp, signOut, getAccessToken }}
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
