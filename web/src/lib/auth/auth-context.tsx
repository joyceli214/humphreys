"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import type { User } from "@/lib/api/generated/types";
import { apiClient } from "@/lib/api/client";
import { firstReadableRoute } from "@/lib/auth/authorization";

type AuthContextType = {
  user: User | null;
  scope: string[];
  loading: boolean;
  hasPermission: (permission: string) => boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshSession: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [scope, setScope] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const refreshSession = async () => {
    try {
      const auth = await apiClient.refresh();
      apiClient.setAccessToken(auth.access_token);
      setUser(auth.user);
      setScope(auth.scope ?? []);
    } catch {
      apiClient.setAccessToken(null);
      setUser(null);
      setScope([]);
      navigate("/login");
    }
  };

  useEffect(() => {
    refreshSession().finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo(
    () => ({
      user,
      scope,
      loading,
      hasPermission: (permission: string) => scope.includes(permission),
      login: async (email: string, password: string) => {
        const auth = await apiClient.login(email, password);
        apiClient.setAccessToken(auth.access_token);
        setUser(auth.user);
        setScope(auth.scope ?? []);
        navigate(firstReadableRoute(auth.scope ?? []));
      },
      logout: async () => {
        await apiClient.logout();
        apiClient.setAccessToken(null);
        setUser(null);
        setScope([]);
        navigate("/login");
      },
      refreshSession
    }),
    [loading, navigate, scope, user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
