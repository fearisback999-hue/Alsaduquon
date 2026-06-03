import { Home } from "lucide-react";
import Link from "next/link";

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-surface">
      <div className="text-center max-w-md px-6">
        <p className="text-7xl font-bold text-fg-faint mb-4">404</p>
        <h1 className="text-xl font-semibold text-fg mb-2">Page not found</h1>
        <p className="text-sm text-fg-subtle mb-8">The page you&apos;re looking for doesn&apos;t exist or has been moved.</p>
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium rounded-lg bg-brand text-white hover:opacity-90 transition-opacity"
        >
          <Home className="h-4 w-4" />
          Back to Dashboard
        </Link>
      </div>
    </div>
  );
}
