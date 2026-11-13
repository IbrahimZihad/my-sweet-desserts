import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import type { Storefront } from "@/lib/storefront";
import { CookieSettingsButton } from "./CookieSettingsButton";

export function LegalShell({
  store,
  title,
  updated,
  children,
}: {
  store: Storefront;
  title: string;
  updated: string;
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-screen">
      <SiteHeader bakeryName={store.name} brandColor={store.brandColor} slug={store.slug} />
      <div className="container-page py-12">
        <div className="mx-auto max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">Legal</p>
          <h1 className="mt-2 font-display text-4xl">{title}</h1>
          <p className="mt-2 text-sm text-muted">Last updated {updated}</p>

          <div className="mt-8 space-y-6 text-sm leading-7 text-muted [&_a]:text-ink [&_a]:underline [&_a]:underline-offset-4 [&_h2]:mt-8 [&_h2]:font-display [&_h2]:text-xl [&_h2]:text-ink [&_h3]:mt-5 [&_h3]:font-semibold [&_h3]:text-ink [&_li]:mt-1 [&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:pl-5 [&_strong]:text-ink [&_table]:w-full [&_table]:border-collapse [&_table]:text-left [&_td]:border-b [&_td]:border-line [&_td]:py-2 [&_td]:pr-4 [&_td]:align-top [&_th]:border-b [&_th]:border-line [&_th]:py-2 [&_th]:pr-4 [&_th]:text-ink [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5">
            {children}
          </div>

          <footer className="mt-12 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line pt-6 text-sm text-muted">
            <Link href="/privacy" className="underline underline-offset-4 hover:text-ink">
              Privacy notice
            </Link>
            <Link href="/cookies" className="underline underline-offset-4 hover:text-ink">
              Cookie policy
            </Link>
            <Link href="/privacy/request" className="underline underline-offset-4 hover:text-ink">
              Your data
            </Link>
            <CookieSettingsButton className="underline underline-offset-4 hover:text-ink" />
            <Link href="/" className="underline underline-offset-4 hover:text-ink">
              Back to {store.name}
            </Link>
          </footer>
        </div>
      </div>
    </main>
  );
}
