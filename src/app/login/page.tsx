"use client";

import React, { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Zap, Lock, ArrowRight, AlertCircle, ShieldAlert, Eye, EyeOff } from "lucide-react";
import { SplineScene } from "@/components/ui/splite";
import { Spotlight } from "@/components/ui/spotlight";
import { CanvasRevealEffect } from "@/components/ui/canvas-reveal-effect";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [rateLimited, setRateLimited] = useState(false);
  const [success, setSuccess] = useState(false);
  const [reverseCanvas, setReverseCanvas] = useState(false);
  const [forwardCanvas, setForwardCanvas] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 800);
  }, []);

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
        setSuccess(true);
        setReverseCanvas(true);
        setTimeout(() => setForwardCanvas(false), 50);
        setTimeout(() => router.push("/dashboard"), 1800);
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
    <div className="flex w-full flex-col min-h-screen bg-black relative overflow-hidden">
      {/* Canvas reveal background */}
      <div className="absolute inset-0 z-0">
        {forwardCanvas && (
          <div className="absolute inset-0">
            <CanvasRevealEffect
              animationSpeed={3}
              containerClassName="bg-black"
              colors={[
                [99, 102, 241],
                [139, 92, 246],
              ]}
              dotSize={5}
              reverse={false}
            />
          </div>
        )}
        {reverseCanvas && (
          <div className="absolute inset-0">
            <CanvasRevealEffect
              animationSpeed={4}
              containerClassName="bg-black"
              colors={[
                [34, 197, 94],
                [16, 185, 129],
              ]}
              dotSize={5}
              reverse={true}
            />
          </div>
        )}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_rgba(0,0,0,0.7)_0%,_rgba(0,0,0,0.95)_70%)]" />
        <div className="absolute top-0 left-0 right-0 h-1/3 bg-gradient-to-b from-black via-black/80 to-transparent" />
        <div className="absolute bottom-0 left-0 right-0 h-1/4 bg-gradient-to-t from-black to-transparent" />
      </div>

      {/* Spotlight effect */}
      <Spotlight
        className="-top-40 left-0 md:left-60 md:-top-20"
        fill="rgba(99, 102, 241, 0.15)"
      />

      {/* Content */}
      <div className="relative z-10 flex flex-col flex-1">
        {/* Top bar */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="fixed top-0 left-0 right-0 z-20 flex items-center justify-center py-6"
        >
          <div className="flex items-center gap-3 px-6 py-2.5 rounded-full border border-white/[0.08] bg-white/[0.03] backdrop-blur-md">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <Zap className="h-4 w-4 text-white" strokeWidth={2.5} fill="currentColor" />
            </div>
            <span className="text-sm font-semibold text-white/90 tracking-tight">NeoPOD</span>
            <span className="text-[10px] uppercase tracking-[0.2em] text-white/30 font-medium ml-1">Engine</span>
          </div>
        </motion.div>

        {/* Main split layout */}
        <div className="flex flex-1 flex-col lg:flex-row min-h-screen">
          {/* Left: Sign in form */}
          <div className="flex-1 flex flex-col justify-center items-center px-6">
            <div className="w-full max-w-sm mt-24 lg:mt-0">
              <AnimatePresence mode="wait">
                {!success ? (
                  <motion.div
                    key="login"
                    initial={{ opacity: 0, x: -60 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -60 }}
                    transition={{ duration: 0.5, ease: "easeOut" }}
                    className="space-y-8"
                  >
                    {/* Header */}
                    <div className="space-y-2 text-center lg:text-left">
                      <motion.h1
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.5, delay: 0.3 }}
                        className="text-4xl md:text-5xl font-bold leading-[1.1] tracking-tight bg-clip-text text-transparent bg-gradient-to-b from-white via-white to-white/40"
                      >
                        Welcome back
                      </motion.h1>
                      <motion.p
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.5, delay: 0.4 }}
                        className="text-lg text-white/40 font-light"
                      >
                        Sign in to your automation engine
                      </motion.p>
                    </div>

                    {/* Form */}
                    <motion.form
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.5, delay: 0.5 }}
                      onSubmit={handleSubmit}
                      className="space-y-4"
                    >
                      <div className="relative group">
                        <Lock className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-white/20 group-focus-within:text-indigo-400 transition-colors pointer-events-none" />
                        <input
                          ref={inputRef}
                          type={showPassword ? "text" : "password"}
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          placeholder="Dashboard password"
                          className={cn(
                            "w-full h-13 pl-11 pr-20 bg-white/[0.04] backdrop-blur-sm",
                            "text-white border border-white/[0.08] rounded-full",
                            "text-sm placeholder:text-white/20",
                            "focus:outline-none focus:border-indigo-500/50 focus:ring-2 focus:ring-indigo-500/10",
                            "transition-all duration-300",
                          )}
                          autoComplete="current-password"
                          disabled={rateLimited}
                        />
                        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setShowPassword(!showPassword)}
                            className="text-white/20 hover:text-white/50 transition-colors p-1.5"
                            tabIndex={-1}
                          >
                            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </button>
                          <button
                            type="submit"
                            disabled={loading || rateLimited}
                            className={cn(
                              "w-9 h-9 flex items-center justify-center rounded-full",
                              "transition-all duration-300 group/btn overflow-hidden",
                              password.trim()
                                ? "bg-gradient-to-br from-indigo-500 to-purple-600 shadow-lg shadow-indigo-500/25 hover:shadow-indigo-500/40"
                                : "bg-white/[0.06]",
                            )}
                          >
                            {loading ? (
                              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            ) : (
                              <span className="relative w-full h-full block overflow-hidden">
                                <span className="absolute inset-0 flex items-center justify-center transition-transform duration-300 group-hover/btn:translate-x-full">
                                  <ArrowRight className="h-4 w-4 text-white/70" />
                                </span>
                                <span className="absolute inset-0 flex items-center justify-center transition-transform duration-300 -translate-x-full group-hover/btn:translate-x-0">
                                  <ArrowRight className="h-4 w-4 text-white" />
                                </span>
                              </span>
                            )}
                          </button>
                        </div>
                      </div>

                      {/* Error message */}
                      <AnimatePresence>
                        {error && (
                          <motion.div
                            initial={{ opacity: 0, y: -10, height: 0 }}
                            animate={{ opacity: 1, y: 0, height: "auto" }}
                            exit={{ opacity: 0, y: -10, height: 0 }}
                            className="overflow-hidden"
                          >
                            <div className={cn(
                              "flex items-center gap-2.5 px-4 py-3 rounded-xl text-sm",
                              rateLimited
                                ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                                : "bg-red-500/10 text-red-400 border border-red-500/20",
                            )}>
                              {rateLimited ? (
                                <ShieldAlert className="h-4 w-4 flex-shrink-0" strokeWidth={2.25} />
                              ) : (
                                <AlertCircle className="h-4 w-4 flex-shrink-0" strokeWidth={2.25} />
                              )}
                              <span>{error}</span>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </motion.form>

                    {/* Footer text */}
                    <motion.p
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ duration: 0.5, delay: 0.8 }}
                      className="text-xs text-white/20 text-center lg:text-left pt-8"
                    >
                      Protected dashboard. Unauthorized access attempts are rate-limited.
                    </motion.p>
                  </motion.div>
                ) : (
                  <motion.div
                    key="success"
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.5, ease: "easeOut" }}
                    className="space-y-6 text-center"
                  >
                    <motion.div
                      initial={{ scale: 0, rotate: -180 }}
                      animate={{ scale: 1, rotate: 0 }}
                      transition={{ duration: 0.6, delay: 0.2, type: "spring", stiffness: 200 }}
                      className="mx-auto w-20 h-20 rounded-2xl bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center shadow-2xl shadow-emerald-500/30"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-white" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    </motion.div>
                    <motion.h1
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.5 }}
                      className="text-3xl font-bold text-white"
                    >
                      You&apos;re in
                    </motion.h1>
                    <motion.p
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 0.7 }}
                      className="text-white/40"
                    >
                      Launching your dashboard...
                    </motion.p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Right: 3D Spline hero */}
          <div className="hidden lg:flex flex-1 relative items-center justify-center">
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 1, delay: 0.3, ease: "easeOut" }}
              className="w-full h-[600px] relative"
            >
              <SplineScene
                scene="https://prod.spline.design/kZDDjO5HuC9GJUM2/scene.splinecode"
                className="w-full h-full"
              />
              {/* Gradient overlay so 3D blends with the dark edges */}
              <div className="absolute inset-0 pointer-events-none bg-gradient-to-l from-transparent via-transparent to-black/60" />
              <div className="absolute inset-0 pointer-events-none bg-gradient-to-r from-transparent via-transparent to-black/30" />
            </motion.div>

            {/* Floating stat cards over the 3D scene */}
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 1.2 }}
              className="absolute bottom-20 left-8 px-5 py-3.5 rounded-2xl border border-white/[0.08] bg-black/60 backdrop-blur-xl"
            >
              <p className="text-[11px] uppercase tracking-widest text-white/30 mb-1">Pipeline Status</p>
              <p className="text-xl font-bold text-emerald-400">Active</p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 1.5 }}
              className="absolute top-24 right-12 px-5 py-3.5 rounded-2xl border border-white/[0.08] bg-black/60 backdrop-blur-xl"
            >
              <p className="text-[11px] uppercase tracking-widest text-white/30 mb-1">Automation</p>
              <p className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-400 to-purple-400">24/7</p>
            </motion.div>
          </div>
        </div>
      </div>
    </div>
  );
}
