"use client";

import Link from "next/link";

export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="grid min-h-screen place-items-center px-6">
      <div className="card max-w-md p-8 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-rose-600">Something went wrong</p>
        <h1 className="mt-3 font-display text-2xl">We couldn&apos;t load the bakery</h1>
        <p className="mt-2 text-sm text-muted">
          The storefront may be briefly unavailable. Try again, or head back to the homepage.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <button type="button" onClick={reset} className="btn-primary">
            Try again
          </button>
          <Link href="/" className="btn-secondary">
            Home
          </Link>
        </div>
      </div>
    </main>
  );
}
