"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";

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

const LEVEL_STYLES: Record<ToastLevel, { ring: string; icon: React.ReactNode; iconColor: string }> = {
  success: {
    ring: "ring-success/30",
    iconColor: "text-success",
    icon: <CheckCircle2 className="h-4 w-4" strokeWidth={2.25} />,
  },
  error: {
    ring: "ring-danger/30",
    iconColor: "text-danger",
    icon: <AlertCircle className="h-4 w-4" strokeWidth={2.25} />,
  },
  info: {
    ring: "ring-info/30",
    iconColor: "text-info",
    icon: <Info className="h-4 w-4" strokeWidth={2.25} />,
  },
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextIdRef = useRef(1);
  const timeoutsRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    const timeouts = timeoutsRef.current;
    return () => {
      timeouts.forEach((t) => clearTimeout(t));
      timeouts.clear();
    };
  }, []);

  const dismiss = useCallback((id: number) => {
    const t = timeoutsRef.current.get(id);
    if (t) {
      clearTimeout(t);
      timeoutsRef.current.delete(id);
    }
    setToasts((prev) => prev.filter((tt) => tt.id !== id));
  }, []);

  const push = useCallback((level: ToastLevel, message: string) => {
    const id = nextIdRef.current++;
    setToasts((prev) => [...prev, { id, level, message }]);
    const timeout = setTimeout(() => {
      timeoutsRef.current.delete(id);
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, TOAST_DURATION_MS);
    timeoutsRef.current.set(id, timeout);
  }, []);

  const api: ToastApi = {
    success: (message) => push("success", message),
    error: (message) => push("error", message),
    info: (message) => push("info", message),
  };

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="true"
        className="fixed bottom-4 right-4 flex flex-col gap-2 z-50 pointer-events-none"
      >
        {toasts.map((t) => {
          const style = LEVEL_STYLES[t.level];
          return (
            <div
              key={t.id}
              role="status"
              className={`glass flex items-start gap-3 px-4 py-3 rounded-xl shadow-lg ring-1 ${style.ring} text-sm text-fg pointer-events-auto max-w-sm animate-slide-in-right`}
            >
              <span className={`mt-0.5 flex-shrink-0 ${style.iconColor}`}>{style.icon}</span>
              <p className="flex-1 leading-snug">{t.message}</p>
              <button
                onClick={() => dismiss(t.id)}
                className="text-fg-faint hover:text-fg transition-colors flex-shrink-0"
                aria-label="Dismiss notification"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
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
