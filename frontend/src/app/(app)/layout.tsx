import { AppShell } from "@/components/AppShell";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { ChatProvider } from "@/contexts/ChatContext";
import { AppMainHeaderProvider } from "@/contexts/AppMainHeaderContext";

export default function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ChatProvider>
      <AppMainHeaderProvider>
        <AppShell>
          <ProtectedRoute>{children}</ProtectedRoute>
        </AppShell>
      </AppMainHeaderProvider>
    </ChatProvider>
  );
}
