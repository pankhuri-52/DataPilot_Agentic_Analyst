"use client";

import { Suspense, useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/lib/supabase";
import { AlertCircle, KeyRound } from "lucide-react";

const TOKEN_KEY = "datapilot_access_token";
const USER_KEY = "datapilot_user";

type PageState = "loading" | "confirm" | "form" | "invalid" | "success";

function ResetPasswordContent() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [otpEmail, setOtpEmail] = useState("");
  const [otpToken, setOtpToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pageState, setPageState] = useState<PageState>("loading");
  const [confirmationUrl, setConfirmationUrl] = useState<string | null>(null);
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!supabase) {
      setPageState("invalid");
      return;
    }

    // Flow 1: User landed with confirmation_url (custom template - token not consumed yet)
    const confUrl = searchParams.get("confirmation_url");
    if (confUrl) {
      setConfirmationUrl(decodeURIComponent(confUrl));
      setPageState("confirm");
      return;
    }

    // Flow 2: User returned from Supabase with tokens in hash (after clicking our "Continue" button)
    const hash = typeof window !== "undefined" ? window.location.hash : "";
    const hashParams = new URLSearchParams(hash.replace("#", ""));
    const type = hashParams.get("type");
    const accessToken = hashParams.get("access_token");
    const refreshToken = hashParams.get("refresh_token");

    if (type === "recovery" && accessToken && refreshToken) {
      supabase.auth
        .setSession({ access_token: accessToken, refresh_token: refreshToken })
        .then(() => setPageState("form"))
        .catch(() => setPageState("invalid"));
      return;
    }

    // Flow 3: Already have session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setPageState(session ? "form" : "invalid");
    });
  }, [searchParams]);

  async function handleOtpSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!otpEmail.trim() || !otpToken.trim()) {
      setError("Email and code are required");
      return;
    }
    if (!supabase) {
      setError("Supabase is not configured.");
      return;
    }
    setLoading(true);
    try {
      const { data, error: otpError } = await supabase.auth.verifyOtp({
        email: otpEmail.trim(),
        token: otpToken.trim(),
        type: "recovery",
      });
      if (otpError) throw otpError;
      if (data.session) {
        setPageState("form");
      } else {
        setError("Invalid or expired code. Request a new reset link.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid or expired code");
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    if (!supabase) {
      setError("Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to .env.local");
      return;
    }
    setLoading(true);
    try {
      const { data: updateData, error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      const { data: sessionData } = await supabase.auth.getSession();
      if (sessionData.session) {
        // Store tokens for our backend (same JWT)
        localStorage.setItem(TOKEN_KEY, sessionData.session.access_token);
        localStorage.setItem(USER_KEY, JSON.stringify({ id: updateData.user?.id, email: updateData.user?.email }));
      }
      setSuccess(true);
      setTimeout(() => router.replace("/"), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update password");
    } finally {
      setLoading(false);
    }
  }

  // Flow 1: User has confirmation_url - show "Continue" button (token not consumed until they click)
  if (pageState === "confirm" && confirmationUrl) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="font-display text-2xl">Reset your password</CardTitle>
            <CardDescription>
              Click the button below to continue. This ensures your reset link works correctly (some email providers preview links and can invalidate them).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <a href={confirmationUrl}>
              <Button className="w-full cursor-pointer">
                Continue to reset password
              </Button>
            </a>
            <p className="text-center text-sm text-muted-foreground">
              Or enter the 6-digit code from your email below.
            </p>
            <form onSubmit={handleOtpSubmit} className="space-y-4">
              <Input
                type="email"
                placeholder="Your email"
                value={otpEmail}
                onChange={(e) => setOtpEmail(e.target.value)}
                required
              />
              <Input
                type="text"
                placeholder="6-digit code from email"
                value={otpToken}
                onChange={(e) => setOtpToken(e.target.value)}
                maxLength={6}
                required
              />
              <Button type="submit" disabled={loading}>
                {loading ? "Verifying..." : "Verify code"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (pageState === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  // Invalid/expired - offer OTP as fallback
  if (pageState === "invalid") {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="font-display text-2xl">Reset your password</CardTitle>
            <CardDescription>
              Your link may have expired or been used. Request a new one, or enter the 6-digit code from your most recent reset email.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Link href="/forgot-password">
              <Button variant="outline" className="w-full">
                Request new reset link
              </Button>
            </Link>
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground">Or enter code from email</span>
              </div>
            </div>
            <form onSubmit={handleOtpSubmit} className="space-y-4">
              {error && (
                <div className="flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                  <AlertCircle className="size-4 shrink-0" />
                  {error}
                </div>
              )}
              <Input
                type="email"
                placeholder="Your email"
                value={otpEmail}
                onChange={(e) => setOtpEmail(e.target.value)}
                required
              />
              <Input
                type="text"
                placeholder="6-digit code"
                value={otpToken}
                onChange={(e) => setOtpToken(e.target.value)}
                maxLength={6}
                required
              />
              <Button type="submit" disabled={loading}>
                {loading ? "Verifying..." : "Verify code"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (success) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="font-display text-2xl flex items-center gap-2 text-primary">
              <KeyRound className="size-6" />
              Password updated
            </CardTitle>
            <CardDescription>
              Your password has been reset successfully. Redirecting you to sign in...
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="font-display text-2xl">Set new password</CardTitle>
          <CardDescription>
            Enter your new password below.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              <AlertCircle className="size-4 shrink-0" />
              {error}
            </div>
          )}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="password" className="text-sm font-medium">
                New password
              </label>
              <Input
                id="password"
                type="password"
                placeholder="At least 6 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="new-password"
                disabled={loading}
                minLength={6}
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="confirmPassword" className="text-sm font-medium">
                Confirm password
              </label>
              <Input
                id="confirmPassword"
                type="password"
                placeholder="Confirm your password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                autoComplete="new-password"
                disabled={loading}
                minLength={6}
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Updating..." : "Update password"}
            </Button>
          </form>
          <p className="text-center text-sm text-muted-foreground">
            <Link href="/login" className="font-medium text-primary hover:underline">
              Back to sign in
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      }
    >
      <ResetPasswordContent />
    </Suspense>
  );
}
