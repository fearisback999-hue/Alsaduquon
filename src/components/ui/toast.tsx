"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

type ToastLevel = "success" | "error" | "info";

interface Toast {
  id: number;
  level: ToastLevel;
  message: string;
}

interface ToastApi {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const TOAST_DURATION_MS = 4000;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((level: ToastLevel, message: string) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, level, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, TOAST_DURATION_MS);
  }, []);

  const api: ToastApi = {
    success: (message) => push("success", message),
    error: (message) => push("error", message),
    info: (message) => push("info", message),
  };

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="fixed bottom-4 right-4 flex flex-col gap-2 z-50 pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={`px-4 py-2.5 rounded-md shadow-lg text-sm pointer-events-auto max-w-sm ${
              t.level === "success"
                ? "bg-green-600 text-white"
                : t.level === "error"
                ? "bg-red-600 text-white"
                : "bg-gray-800 text-white"
            }`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // Safe no-op fallback so components rendered outside the provider don't crash
    const noop = () => {
      if (typeof console !== "undefined") {
        console.warn("useToast called outside ToastProvider");
      }
    };
    return { success: noop, error: noop, info: noop };
  }
  return ctx;
}

// Also support usage without the hook pattern (for simple callers)
export function useToastEffect(message: string | null, level: ToastLevel = "info") {
  const toast = useToast();
  useEffect(() => {
    if (message) toast[level](message);
  }, [message, level, toast]);
}
