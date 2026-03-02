"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

type AlertVariant = "success" | "destructive";

type AlertItem = {
  id: number;
  title: string;
  description?: string;
  variant: AlertVariant;
};

type AlertsContextType = {
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
};

const AlertsContext = createContext<AlertsContextType | null>(null);

export function AlertsProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<AlertItem[]>([]);

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const push = useCallback((variant: AlertVariant, title: string, description?: string) => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setItems((prev) => [...prev, { id, title, description, variant }]);
    setTimeout(() => dismiss(id), 4500);
  }, [dismiss]);

  const value = useMemo(
    () => ({
      success: (title: string, description?: string) => push("success", title, description),
      error: (title: string, description?: string) => push("destructive", title, description)
    }),
    [push]
  );

  return (
    <AlertsContext.Provider value={value}>
      {children}
      <div className="fixed right-4 top-4 z-[100] flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2">
        {items.map((item) => (
          <Alert key={item.id} variant={item.variant}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <AlertTitle>{item.title}</AlertTitle>
                {item.description && <AlertDescription>{item.description}</AlertDescription>}
              </div>
              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => dismiss(item.id)}>
                Close
              </Button>
            </div>
          </Alert>
        ))}
      </div>
    </AlertsContext.Provider>
  );
}

export function useAlerts() {
  const ctx = useContext(AlertsContext);
  if (!ctx) throw new Error("useAlerts must be used within AlertsProvider");
  return ctx;
}
