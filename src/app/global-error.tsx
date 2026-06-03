"use client";

import { AlertTriangle, RotateCcw, Home } from "lucide-react";

export default function GlobalError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="en">
      <body className="bg-black text-white min-h-screen flex items-center justify-center">
        <div className="max-w-md w-full p-8 text-center">
          <div className="mx-auto h-14 w-14 rounded-full bg-red-500/10 flex items-center justify-center mb-4">
            <AlertTriangle className="h-7 w-7 text-red-400" strokeWidth={2} />
          </div>
          <h1 className="text-xl font-semibold mb-2">Something went wrong</h1>
          <p className="text-sm text-white/50 mb-6 break-words">{error.message}</p>
          <div className="flex gap-3 justify-center">
            <button
              onClick={reset}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-white/10 hover:bg-white/15 transition-colors"
            >
              <RotateCcw className="h-4 w-4" />
              Try again
            </button>
            <a
              href="/dashboard"
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-indigo-600 hover:bg-indigo-500 transition-colors"
            >
              <Home className="h-4 w-4" />
              Dashboard
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}
