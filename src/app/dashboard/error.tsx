"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function DashboardError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex items-center justify-center min-h-[50vh]">
      <Card className="max-w-md w-full p-8 text-center animate-fade-in-up" variant="elevated">
        <div className="mx-auto h-12 w-12 rounded-full bg-danger-subtle flex items-center justify-center mb-4">
          <AlertTriangle className="h-6 w-6 text-danger" strokeWidth={2} />
        </div>
        <h2 className="text-lg font-semibold text-fg mb-1">Something went wrong</h2>
        <p className="text-sm text-fg-subtle mb-6 break-words">{error.message}</p>
        <Button
          onClick={reset}
          variant="primary"
          leftIcon={<RotateCcw className="h-4 w-4" />}
        >
          Try again
        </Button>
      </Card>
    </div>
  );
}
