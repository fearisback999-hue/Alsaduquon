import { Sidebar } from "@/components/ui/sidebar";
import { ToastProvider } from "@/components/ui/toast";
import { HeroGeometric } from "@/components/ui/shape-landing-hero";
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
        <HeroGeometric />
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
