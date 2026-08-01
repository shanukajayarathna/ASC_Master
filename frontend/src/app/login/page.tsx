"use client";

import BrandLogo from "@/components/shell/BrandLogo";
import { useAuth } from "@/context/AuthContext";
import { ApiError } from "@/lib/api";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import TextField from "@mui/material/TextField";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export default function LoginPage() {
  const { user, loading, login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Already signed in and landed here anyway (e.g. a stale bookmark) — the app, not the
  // login form, is where that session belongs.
  useEffect(() => {
    if (!loading && user) router.replace("/dashboard");
  }, [loading, user, router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(email, password);
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't log in. Try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading || user) {
    return (
      <div className="flex items-center justify-center min-h-screen" style={{ background: "var(--brand-gradient)" }}>
        <CircularProgress size={28} sx={{ color: "#fff" }} />
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

        <form onSubmit={submit} className="px-8 pt-6 pb-8">
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
            />
          </div>

          <Button type="submit" variant="contained" color="primary" fullWidth disabled={submitting} size="large">
            {submitting ? "Logging in…" : "Log in"}
          </Button>
        </form>
      </div>
    </div>
  );
}
