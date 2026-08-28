"use client";

import AuthShell from "@/components/auth/AuthShell";
import { ApiError, api } from "@/lib/api";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import { useState } from "react";

/**
 * This app is admin-provisioned only — there's no self-service signup (see
 * AuthController.Register, which only ever succeeds unauthenticated to bootstrap the very
 * first account). This page is the public front door's stand-in for that: a submission an
 * Admin reviews in the Admin Panel's "Landing Page" section and, if approved, turns into a
 * real account via the existing Users flow.
 */
export default function RequestAccessPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const { busy, run: submit } = useAsyncAction(async () => {
    setError(null);
    try {
      await api.submitAccessRequest({ name, email, company, message });
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't send your request. Try again.");
    }
  });

  return (
    <AuthShell>
      {submitted ? (
        <div className="text-center">
          <h1 className="font-display text-xl font-bold text-text-strong m-0 mb-3">Request sent</h1>
          <p className="text-[13px] text-text-muted m-0">
            An administrator will review your request and reach out with access details.
          </p>
          <a href="/" className="inline-block mt-6 text-[13px]" style={{ color: "var(--liquor)" }}>
            ← Back to the homepage
          </a>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <h1 className="font-display text-xl font-bold text-text-strong m-0 mb-1 text-center">Request Access</h1>
          <p className="text-[13px] text-text-muted text-center mb-6">
            Accounts are provisioned by an administrator. Tell us who you are and we&apos;ll follow up.
          </p>

          {error && (
            <div className="mb-4 p-3 rounded-[var(--radius-lg)] border border-danger bg-danger-light text-[13px] text-danger">
              {error}
            </div>
          )}

          <div className="flex flex-col gap-3.5 mb-6">
            <TextField label="Full name" value={name} onChange={(e) => setName(e.target.value)} size="small" required fullWidth disabled={busy} />
            <TextField label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} size="small" required fullWidth disabled={busy} />
            <TextField label="Company / Estate" value={company} onChange={(e) => setCompany(e.target.value)} size="small" required fullWidth disabled={busy} />
            <TextField
              label="What would you like to use this for? (optional)"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              size="small"
              fullWidth
              multiline
              minRows={2}
              disabled={busy}
            />
          </div>

          <Button type="submit" variant="contained" color="primary" fullWidth disabled={busy} aria-busy={busy} size="large">
            {busy ? "Sending…" : "Send Request"}
          </Button>

          <p className="text-[12.5px] text-center mt-5 mb-0">
            <a href="/login" style={{ color: "var(--liquor)" }}>Already have an account? Sign in</a>
          </p>
        </form>
      )}
    </AuthShell>
  );
}
