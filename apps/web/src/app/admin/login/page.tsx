"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const payload = (await response.json()) as { message?: string };
      if (!response.ok) throw new Error(payload.message ?? "Sign in failed.");
      router.replace("/admin");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Sign in failed.");
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <section className="hidden flex-col justify-between bg-ink p-12 text-cream lg:flex">
        <p className="font-display text-2xl">CakeFlow</p>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cream/50">Baker dashboard</p>
          <h1 className="mt-4 max-w-md font-display text-5xl leading-tight">
            Fewer no-shows.
            <br />
            More cake.
          </h1>
          <p className="mt-5 max-w-sm text-sm leading-6 text-cream/70">
            Deposits, pickup capacity and your booking ledger — in one quiet little dashboard.
          </p>
        </div>
        <p className="text-xs text-cream/40">Pickup only · Melbourne</p>
      </section>

      <section className="grid place-items-center px-6 py-12">
        <form onSubmit={submit} className="w-full max-w-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted">Welcome back</p>
          <h2 className="mt-2 font-display text-3xl">Sign in</h2>
          <p className="mt-2 text-sm text-muted">Use the staff account for this bakery.</p>

          <div className="mt-8 space-y-4">
            <div>
              <label className="label" htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                className="input"
                autoComplete="username"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </div>
            <div>
              <label className="label" htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                className="input"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                minLength={10}
                required
              />
            </div>
          </div>

          {error ? (
            <p role="alert" className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </p>
          ) : null}

          <button type="submit" className="btn-primary mt-6 w-full py-3.5" disabled={busy}>
            {busy ? "Signing in…" : "Sign in to dashboard"}
          </button>

          <p className="mt-6 text-center text-xs text-muted">
            Customer? <a href="/" className="underline underline-offset-4 hover:text-ink">Back to the bakery</a>
          </p>
        </form>
      </section>
    </main>
  );
}
