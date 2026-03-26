import { AuthThemeCorner } from "./AuthThemeCorner";

export default function AuthLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="relative min-h-screen bg-background text-foreground">
      <AuthThemeCorner />
      {children}
    </div>
  );
}
