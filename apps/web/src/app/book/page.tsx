import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { BookingWizard } from "@/components/booking/BookingWizard";
import { getStorefront } from "@/lib/storefront.server";

export const dynamic = "force-dynamic";

export default async function BookPage({
  searchParams,
}: {
  searchParams: { cake?: string };
}) {
  const store = await getStorefront();
  const initialCakeId =
    store.cakes.find((cake) => cake.id === searchParams.cake)?.id ?? store.cakes[0]?.id ?? "";

  return (
    <main className="min-h-screen">
      <SiteHeader bakeryName={store.name} brandColor={store.brandColor} slug={store.slug} />

      <div className="container-page py-10">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">Reserve a pickup</p>
            <h1 className="mt-2 font-display text-3xl sm:text-4xl">Book your cake</h1>
          </div>
          <Link href="/" className="text-sm text-muted underline-offset-4 hover:text-ink hover:underline">
            ← Back to the menu
          </Link>
        </div>

        {store.cakes.length === 0 ? (
          <div className="card p-8 text-sm text-muted">
            There are no cakes available right now. Please check back soon.
          </div>
        ) : (
          <BookingWizard store={store} initialCakeId={initialCakeId} />
        )}
      </div>
    </main>
  );
}
