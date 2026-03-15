import { AppShell } from "@/components/AppShell";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { ChatProvider } from "@/contexts/ChatContext";

export default function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ChatProvider>
      <AppShell>
        <ProtectedRoute>{children}</ProtectedRoute>
      </AppShell>
    </ChatProvider>
  );
}
