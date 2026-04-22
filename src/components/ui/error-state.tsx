"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "./button";
import { Card } from "./card";

interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
  retrying?: boolean;
}

export function ErrorState({
  title = "Couldn't load data",
  message,
  onRetry,
  retrying,
}: ErrorStateProps) {
  return (
    <Card className="animate-fade-in">
      <div className="flex flex-col items-center justify-center text-center py-10 px-6">
        <div className="mb-4 h-12 w-12 rounded-full bg-danger-subtle flex items-center justify-center">
          <AlertTriangle className="h-5 w-5 text-danger" strokeWidth={2} />
        </div>
        <h3 className="text-sm font-semibold text-fg mb-1">{title}</h3>
        <p className="text-sm text-fg-subtle max-w-sm mb-4 break-words">{message}</p>
        {onRetry && (
          <Button
            variant="secondary"
            size="sm"
            onClick={onRetry}
            loading={retrying}
            leftIcon={<RotateCcw className="h-3.5 w-3.5" />}
          >
            Try again
          </Button>
        )}
      </div>
    </Card>
  );
}
