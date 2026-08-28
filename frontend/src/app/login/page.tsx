"use client";

import AuthShell from "@/components/auth/AuthShell";
import LoggedOutNotice from "@/components/auth/LoggedOutNotice";
import TeaCinematic from "@/components/auth/TeaCinematic";
import { useAuth } from "@/context/AuthContext";
import { ApiError } from "@/lib/api";
import FullScreenLoader from "@/components/shared/FullScreenLoader";
import TeaLoader from "@/components/shared/TeaLoader";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { useForceLogoutOnPublicPage } from "@/hooks/useForceLogoutOnPublicPage";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const { loading, login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  // The "Ceylon Tea Journey" intro overlay (TeaCinematic) — purely visual, plays full-screen
  // above the split-screen layout below and then fades away. Component-local state on
  // purpose: docs/28's no-global-loading-state rule applies to this too.
  const [introDone, setIntroDone] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);

  // Focus the email field only once the intro has cleared. A plain autoFocus would grab
  // focus at mount — while the cinematic still covers the form — and the browser's email
  // autofill suggestion list renders in its own native layer, so it would pop up floating
  // over the intro. Deferring focus keeps autofill exactly where it belongs: on the form.
  useEffect(() => {
    if (introDone) emailRef.current?.focus();
  }, [introDone]);

  // Reaching /login with a session still live in this tab (e.g. the browser Back button out
  // of the authenticated app) used to silently `router.replace` straight back into the
  // dashboard, skipping re-entering credentials entirely — the same underlying gap as "/"'s,
  // just less obvious since it never showed a form to notice was being skipped. Now it ends
  // that session and shows the login form instead, same as "/".
  const justLoggedOut = useForceLogoutOnPublicPage();

  // useAsyncAction's synchronous guard is what actually stops a double-Enter from firing two
  // overlapping login calls — the previous `submitting` state alone couldn't, since React
  // batches that update rather than applying it before a second call already in flight reads it.
  const { busy: submitting, run: submit } = useAsyncAction(async () => {
    setError(null);
    try {
      const loggedInUser = await login(email, password);
      router.push(loggedInUser.roles.includes("Admin") ? "/admin" : "/dashboard");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't log in. Try again.");
    }
  });

  if (loading) {
    return (
      <div className="login-bg flex items-center justify-center min-h-screen">
        <FullScreenLoader message="Preparing your workspace…" onDark />
      </div>
    );
  }

  return (
    <>
      {!introDone && <TeaCinematic onDone={() => setIntroDone(true)} />}

      <AuthShell>
        {justLoggedOut && <LoggedOutNotice />}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <h1 className="font-display text-xl font-bold text-text-strong m-0 mb-1 text-center">Log in to continue</h1>
          <p className="text-[13px] text-center mb-6" style={{ color: "var(--text-muted)" }}>
            Sign in with your ASC Intelligent Hub account.
          </p>

          {error && (
            <div className="mb-4 p-3 rounded-[var(--radius-lg)] border border-danger bg-danger-light text-[13px] text-danger">
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
              inputRef={emailRef}
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
            {submitting ? (
              // Compact branded processing state — the house TeaLoader at button scale,
              // never a replay of the intro cinematic (docs/28 decision rule 3).
              <span className="inline-flex items-center gap-2">
                <TeaLoader size={20} onDark />
                Logging in…
              </span>
            ) : (
              "Log in"
            )}
          </Button>

          <p className="text-[12.5px] text-center mt-5 mb-0">
            <a href="/request-access" style={{ color: "var(--liquor)" }}>Need access? Request it</a>
          </p>
        </form>
      </AuthShell>
    </>
  );
}
