import { Sidebar } from "@/components/ui/sidebar";
import { ToastProvider } from "@/components/ui/toast";
import { requireSession } from "@/lib/auth/require-session";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  await requireSession();

  return (
    <ToastProvider>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[60] focus:px-4 focus:py-2 focus:bg-brand focus:text-brand-fg focus:rounded-lg focus:shadow-lg"
      >
        Skip to content
      </a>
      <div className="flex min-h-screen bg-bg relative">
        {/* Ambient glow background — gives the dashboard the same depth as the login */}
        <div className="pointer-events-none fixed inset-0 z-0 aurora-bg" aria-hidden="true" />
        <div
          className="pointer-events-none fixed top-0 left-1/4 z-0 h-[400px] w-[600px] -translate-y-1/2 rounded-full opacity-[0.07] blur-[120px]"
          style={{ background: "radial-gradient(circle, rgb(129 140 248), transparent 70%)" }}
          aria-hidden="true"
        />
        <Sidebar />
        <main id="main-content" aria-label="Main content" className="flex-1 min-w-0 relative z-10">
          <div className="pt-16 lg:pt-0">
            <div className="p-4 sm:p-6 lg:p-8 max-w-[1400px] mx-auto">{children}</div>
          </div>
        </main>
      </div>
    </ToastProvider>
  );
}
