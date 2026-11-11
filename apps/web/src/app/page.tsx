import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { formatMoney } from "@/lib/format";
import { getStorefront } from "@/lib/storefront.server";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const store = await getStorefront();
  const depositCopy =
    store.depositType === "PERCENTAGE"
      ? `${store.depositValue / 100}% deposit`
      : `${formatMoney(store.depositValue, store.currency)} deposit`;

  return (
    <main className="min-h-screen">
      <SiteHeader bakeryName={store.name} brandColor={store.brandColor} slug={store.slug} />

      <section className="container-page grid gap-10 py-14 lg:grid-cols-[1.1fr_0.9fr] lg:items-center lg:py-20">
        <div>
          <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-line bg-white px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-muted">
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: store.brandColor }} />
            Pickup only · {store.suburb ?? "Melbourne"}
          </p>
          <h1 className="font-display text-4xl leading-[1.05] tracking-tight sm:text-6xl">
            A cake worth
            <br />
            <em className="not-italic" style={{ color: store.brandColor }}>
              clearing your calendar
            </em>
            <br />
            for.
          </h1>
          <p className="mt-6 max-w-xl text-base leading-7 text-muted sm:text-lg">
            {store.about ??
              "Small-batch celebration cakes, baked to order. Choose your cake, lock in a pickup window, and pay a deposit to hold it."}
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link href="/book" className="btn-primary px-8 py-3.5">
              Start your booking
            </Link>
            <Link href="#cakes" className="btn-secondary px-6 py-3.5">
              See the cakes
            </Link>
          </div>
          <p className="mt-5 text-xs text-muted">
            {depositCopy} · {store.depositRefundable ? `refundable up to ${store.refundWindowHours}h before pickup` : "non-refundable"} ·{" "}
            {store.leadTimeHours}h notice
          </p>
        </div>

        <div className="relative">
          <div
            className="absolute -inset-4 rounded-[2rem] opacity-15 blur-2xl"
            style={{ backgroundColor: store.brandColor }}
            aria-hidden
          />
          {store.heroImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={store.heroImageUrl}
              alt={`A celebration cake from ${store.name}`}
              className="relative aspect-[4/5] w-full rounded-[2rem] object-cover shadow-soft"
            />
          ) : (
            <div
              className="relative grid aspect-[4/5] w-full place-items-center overflow-hidden rounded-[2rem] p-10 text-center shadow-soft"
              style={{
                background: `radial-gradient(circle at 30% 20%, #fff 0%, #f7e7ee 42%, ${store.brandColor} 100%)`,
              }}
            >
              <div className="rounded-2xl bg-white/80 px-6 py-8 backdrop-blur">
                <p className="font-display text-5xl" style={{ color: store.brandColor }}>
                  ♥
                </p>
                <p className="mt-3 font-display text-2xl">Baked with care</p>
                <p className="mt-1 text-sm text-muted">in {store.suburb ?? "Melbourne"}</p>
              </div>
            </div>
          )}
        </div>
      </section>

      <section id="cakes" className="border-y border-line bg-white/60 py-16">
        <div className="container-page">
          <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">The menu</p>
              <h2 className="mt-2 font-display text-3xl sm:text-4xl">Pick your cake</h2>
            </div>
            <p className="max-w-sm text-sm text-muted">
              Every cake is a fixed recipe and size — no fiddly modifiers. What you see is what gets boxed.
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {store.cakes.map((cake, index) => (
              <article key={cake.id} className="card group flex flex-col overflow-hidden">
                {cake.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={cake.imageUrl} alt={cake.name} className="aspect-[4/3] w-full object-cover" />
                ) : (
                  <div
                    className="grid aspect-[4/3] w-full place-items-center"
                    style={{
                      background: [
                        "linear-gradient(135deg,#f8e7ee,#e9c3d3)",
                        "linear-gradient(135deg,#efe6dc,#d8c2ab)",
                        "linear-gradient(135deg,#f4f0d9,#e4dcae)",
                      ][index % 3],
                    }}
                  >
                    <span className="font-display text-4xl text-white/80">{cake.sizeLabel}</span>
                  </div>
                )}
                <div className="flex flex-1 flex-col p-6">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="font-display text-xl">{cake.name}</h3>
                    <p className="whitespace-nowrap font-semibold">{formatMoney(cake.priceCents, store.currency)}</p>
                  </div>
                  <p className="mt-1 text-xs uppercase tracking-wide text-muted">
                    {cake.sizeLabel} · serves {cake.servings} · {cake.flavour}
                  </p>
                  <p className="mt-3 flex-1 text-sm leading-6 text-muted">{cake.description}</p>
                  {cake.allergens?.length ? (
                    <p className="mt-3 text-xs text-muted/80">Contains: {cake.allergens.join(", ")}</p>
                  ) : null}
                  <Link
                    href={`/book?cake=${cake.id}`}
                    className="btn-secondary mt-5 w-full group-hover:border-rose-300 group-hover:bg-rose-50"
                  >
                    Choose this cake
                  </Link>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="how" className="container-page py-16">
        <div className="grid gap-6 sm:grid-cols-3">
          {[
            {
              step: "01",
              title: "Choose cake & time",
              copy: "Pick a fixed-size cake and a pickup window that suits you. Live capacity means no double bookings.",
            },
            {
              step: "02",
              title: "Pay the deposit",
              copy: `${depositCopy} secures your slot through Stripe. The balance is paid at pickup.`,
            },
            {
              step: "03",
              title: "Pick up & celebrate",
              copy: "You'll get a confirmation email with the address, pickup time and a booking reference.",
            },
          ].map((item) => (
            <div key={item.step} className="card p-6">
              <p className="text-xs font-semibold tracking-[0.2em]" style={{ color: store.brandColor }}>
                {item.step}
              </p>
              <h3 className="mt-3 font-display text-xl">{item.title}</h3>
              <p className="mt-2 text-sm leading-6 text-muted">{item.copy}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-line py-10">
        <div className="container-page flex flex-col gap-2 text-xs text-muted sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {new Date().getFullYear()} {store.name} · {store.addressLine}, {store.suburb} {store.postcode}
          </p>
          <p>Deposits secured by Stripe · Pickup only</p>
        </div>
      </footer>
    </main>
  );
}
