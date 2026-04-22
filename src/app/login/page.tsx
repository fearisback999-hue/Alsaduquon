"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Zap, Lock, ArrowRight, AlertCircle, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [rateLimited, setRateLimited] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!password.trim()) {
      setError("Please enter a password.");
      return;
    }
    setLoading(true);
    setError("");
    setRateLimited(false);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      if (res.ok) {
        router.push("/dashboard");
      } else if (res.status === 429) {
        setRateLimited(true);
        setError("Too many failed attempts. Please wait 15 minutes.");
        setLoading(false);
      } else {
        setError("Invalid password. Please try again.");
        setLoading(false);
      }
    } catch {
      setError("Network error. Please check your connection.");
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg aurora-bg relative overflow-hidden p-4">
      <div className="absolute inset-0 grid-pattern opacity-30 pointer-events-none" aria-hidden="true" />

      {/* Decorative orbs */}
      <div className="absolute top-1/4 left-1/4 w-64 h-64 bg-brand/5 rounded-full blur-3xl pointer-events-none animate-float" aria-hidden="true" />
      <div className="absolute bottom-1/4 right-1/4 w-48 h-48 bg-info/5 rounded-full blur-3xl pointer-events-none animate-float" style={{ animationDelay: "1.5s" }} aria-hidden="true" />

      <div className="w-full max-w-md relative">
        {/* Brand header */}
        <div className="flex items-center justify-center gap-3 mb-8 animate-fade-in-up">
          <div className="h-11 w-11 rounded-xl bg-brand flex items-center justify-center shadow-glow">
            <Zap className="h-5 w-5 text-brand-fg" strokeWidth={2.5} fill="currentColor" />
          </div>
          <div>
            <div className="text-xl font-bold tracking-tight text-fg">NeoPOD</div>
            <div className="text-[11px] uppercase tracking-widest text-fg-faint font-medium">Automation Engine</div>
          </div>
        </div>

        {/* Card */}
        <div
          className="glass rounded-2xl p-8 shadow-lg animate-fade-in-up"
          style={{ animationDelay: "80ms" }}
        >
          <h1 className="text-xl font-semibold text-fg tracking-tight">Welcome back</h1>
          <p className="text-sm text-fg-subtle mt-1 mb-6">
            Sign in to manage your automated POD pipeline.
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="password" className="block text-xs font-medium text-fg-muted mb-1.5">
                Dashboard password
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-fg-faint pointer-events-none" />
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full h-11 pl-10 pr-4 bg-surface border border-border rounded-lg text-sm text-fg placeholder:text-fg-faint focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 transition-all"
                  autoFocus
                  autoComplete="current-password"
                  disabled={rateLimited}
                />
              </div>
            </div>

            {error && (
              <div
                role="alert"
                className={`flex items-start gap-2 px-3 py-2.5 rounded-lg text-sm animate-scale-in ${
                  rateLimited
                    ? "bg-warning-subtle text-warning"
                    : "bg-danger-subtle text-danger"
                }`}
              >
                {rateLimited ? (
                  <ShieldAlert className="h-4 w-4 flex-shrink-0 mt-0.5" strokeWidth={2.25} />
                ) : (
                  <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" strokeWidth={2.25} />
                )}
                <span>{error}</span>
              </div>
            )}

            <Button
              type="submit"
              loading={loading}
              size="lg"
              className="w-full"
              disabled={rateLimited}
              rightIcon={!loading ? <ArrowRight className="h-4 w-4" /> : undefined}
            >
              {loading ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </div>

        <p
          className="text-xs text-fg-faint text-center mt-6 animate-fade-in-up"
          style={{ animationDelay: "160ms" }}
        >
          Protected dashboard. Unauthorized access attempts are rate-limited.
        </p>
      </div>
    </div>
  );
}
