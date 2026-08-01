"use client";

import { useAuth } from "@/context/AuthContext";
import { ApiError } from "@/lib/api";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className="flex justify-center pt-12">
      <form onSubmit={submit} className="w-full max-w-sm">
        <h1 className="font-display text-2xl font-bold text-text-strong m-0 mb-1">Log in</h1>
        <p className="text-[13px] text-text-muted m-0 mb-6">Asia Siyaka Intelligence Hub</p>

        {error && (
          <div className="mb-4 p-3.5 rounded border border-danger bg-danger-light text-sm text-liquor-dark">{error}</div>
        )}

        <div className="flex flex-col gap-3.5 mb-5">
          <TextField
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            size="small"
            required
            autoFocus
          />
          <TextField
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            size="small"
            required
          />
        </div>

        <Button type="submit" variant="contained" color="primary" fullWidth disabled={submitting}>
          {submitting ? "Logging in…" : "Log in"}
        </Button>
      </form>
    </div>
  );
}
