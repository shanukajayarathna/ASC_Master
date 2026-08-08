"use client";

import BrandLogo from "@/components/shell/BrandLogo";
import { useAuth } from "@/context/AuthContext";
import { ApiError } from "@/lib/api";
import FullScreenLoader from "@/components/shared/FullScreenLoader";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export default function LoginPage() {
  const { user, loading, login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Already signed in and landed here anyway (e.g. a stale bookmark) — the app, not the
  // login form, is where that session belongs.
  useEffect(() => {
    if (!loading && user) router.replace("/dashboard");
  }, [loading, user, router]);

  // useAsyncAction's synchronous guard is what actually stops a double-Enter from firing two
  // overlapping login calls — the previous `submitting` state alone couldn't, since React
  // batches that update rather than applying it before a second call already in flight reads it.
  const { busy: submitting, run: submit } = useAsyncAction(async () => {
    setError(null);
    try {
      await login(email, password);
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't log in. Try again.");
    }
  });

  if (loading || user) {
    return (
      <div className="flex items-center justify-center min-h-screen" style={{ background: "var(--brand-gradient)" }}>
        <FullScreenLoader message="Preparing your workspace…" onDark />
      </div>
    );
  }

  return (
    <div
      className="flex items-center justify-center min-h-screen px-5"
      style={{ background: "var(--brand-gradient)" }}
    >
      <div
        className="w-full max-w-[380px] rounded-lg overflow-hidden"
        style={{ background: "var(--paper-0)", boxShadow: "var(--shadow-lg)" }}
      >
        {/* Fixed light band, independent of the app's own theme — the artwork is drawn for
            light surfaces (same fix Sidebar uses for the same logo, same reason). */}
        <div className="flex flex-col items-center gap-2 pt-8 pb-6 px-8" style={{ background: "#F7F3E8" }}>
          <BrandLogo height={52} />
          <p className="font-mono text-[10px] tracking-widest uppercase m-0" style={{ color: "var(--brand-olive-deep)" }}>
            Intelligence Hub
          </p>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="px-8 pt-6 pb-8"
        >
          <h1 className="font-display text-xl font-bold text-text-strong m-0 mb-5">Log in to continue</h1>

          {error && (
            <div className="mb-4 p-3 rounded border border-danger bg-danger-light text-[13px] text-liquor-dark">
              {error}
            </div>
          )}

          <div className="flex flex-col gap-3.5 mb-6">
            <TextField
              label="Email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              size="small"
              required
              autoFocus
              fullWidth
              disabled={submitting}
            />
            <TextField
              label="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              size="small"
              required
              fullWidth
              disabled={submitting}
            />
          </div>

          <Button
            type="submit"
            variant="contained"
            color="primary"
            fullWidth
            disabled={submitting}
            aria-busy={submitting}
            size="large"
          >
            {submitting ? "Logging in…" : "Log in"}
          </Button>
        </form>
      </div>
    </div>
  );
}
