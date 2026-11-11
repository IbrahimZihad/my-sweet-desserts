import Link from "next/link";

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center px-6">
      <div className="card max-w-md p-8 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-rose-600">404</p>
        <h1 className="mt-3 font-display text-2xl">That page has been eaten</h1>
        <p className="mt-2 text-sm text-muted">The link may be old, or the bakery has moved.</p>
        <Link href="/" className="btn-primary mt-6">
          Back to the bakery
        </Link>
      </div>
    </main>
  );
}
