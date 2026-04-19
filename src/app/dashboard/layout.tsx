import { Sidebar } from "@/components/ui/sidebar";
import { ToastProvider } from "@/components/ui/toast";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <div className="flex min-h-screen">
        <Sidebar />
        <main className="flex-1 bg-gray-50">
          <div className="p-6">{children}</div>
        </main>
      </div>
    </ToastProvider>
  );
}
