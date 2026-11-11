import Link from "next/link";

interface SiteHeaderProps {
  bakeryName: string;
  brandColor: string;
  slug: string;
}

export function SiteHeader({ bakeryName, brandColor, slug }: SiteHeaderProps) {
  return (
    <header className="border-b border-line/80 bg-cream/90 backdrop-blur">
      <div className="container-page flex h-20 items-center justify-between">
        <Link href="/" className="flex items-center gap-3">
          <span
            aria-hidden
            className="grid h-9 w-9 place-items-center rounded-full text-sm font-bold text-white"
            style={{ backgroundColor: brandColor }}
          >
            {bakeryName.slice(0, 1)}
          </span>
          <span className="font-display text-xl tracking-tight">{bakeryName}</span>
        </Link>

        <nav className="flex items-center gap-2 text-sm sm:gap-5">
          <Link href="/#cakes" className="hidden px-2 py-2 text-muted transition hover:text-ink sm:block">
            Cakes
          </Link>
          <Link href="/#how" className="hidden px-2 py-2 text-muted transition hover:text-ink sm:block">
            How it works
          </Link>
          <Link href="/book" className="btn-primary">
            Book a pickup
          </Link>
          <Link
            href="/admin"
            className="hidden text-xs text-muted/70 transition hover:text-ink md:block"
            aria-label={`${bakeryName} admin`}
          >
            Baker login
          </Link>
        </nav>
      </div>
      <span data-tenant={slug} className="hidden" />
    </header>
  );
}
