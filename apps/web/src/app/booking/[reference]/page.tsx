import Link from "next/link";
import { notFound } from "next/navigation";
import type { BookingSummaryDto } from "@cakeflow/contracts";
import { SiteHeader } from "@/components/SiteHeader";
import { OrderStatusBadge, PaymentStatusBadge } from "@/components/admin/StatusBadge";
import { apiFetch, ApiError } from "@/lib/api";
import { formatDateTime, formatMoney } from "@/lib/format";
import { getStorefront } from "@/lib/storefront.server";
import { resolveTenantSlug } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export default async function BookingConfirmationPage({
  params,
  searchParams,
}: {
  params: { reference: string };
  searchParams: { email?: string | string[] };
}) {
  const email = Array.isArray(searchParams.email) ? searchParams.email[0] : searchParams.email;
  const store = await getStorefront();

  if (!email) {
    return (
      <Shell store={store}>
        <div className="card mx-auto max-w-lg p-8 text-center">
          <h1 className="font-display text-2xl">Check your email</h1>
          <p className="mt-2 text-sm text-muted">
            For privacy, bookings open from the link in your confirmation email.
          </p>
          <Link href="/" className="btn-secondary mt-6">Back to the bakery</Link>
        </div>
      </Shell>
    );
  }

  let booking: BookingSummaryDto;
  try {
    booking = await apiFetch<BookingSummaryDto>(
      `/v1/bookings/${encodeURIComponent(params.reference)}?email=${encodeURIComponent(email)}`,
      { tenantSlug: resolveTenantSlug() },
    );
  } catch (caught) {
    if (caught instanceof ApiError && caught.status === 404) notFound();
    throw caught;
  }

  return (
    <Shell store={store}>
      <div className="card mx-auto max-w-2xl p-8 sm:p-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">Booking {booking.reference}</p>
            <h1 className="mt-2 font-display text-3xl">
              {booking.status === "CONFIRMED"
                ? "You're booked in"
                : booking.status === "HELD"
                  ? "Awaiting your deposit"
                  : `Booking ${booking.status.toLowerCase()}`}
            </h1>
          </div>
          <OrderStatusBadge status={booking.status} />
        </div>

        <dl className="mt-7 space-y-4 border-y border-line py-6 text-sm">
          <Row label="Cake" value={booking.cakeName} />
          <Row label="Pickup" value={formatDateTime(booking.slotStartsAt, store.timezone)} />
          <Row label="Cake total" value={formatMoney(booking.totalCents, store.currency)} />
          <Row label="Deposit" value={`${formatMoney(booking.depositCents, store.currency)} · ${booking.depositStatus}`} />
          <Row label="Balance at pickup" value={formatMoney(booking.totalCents - booking.depositCents, store.currency)} />
          <Row label="Name" value={booking.customerName} />
          <Row label="Email" value={booking.customerEmail} />
        </dl>

        <div className="mt-5 rounded-xl bg-cream p-4 text-sm text-muted">
          <p className="font-semibold text-ink">{store.name}</p>
          <p className="mt-1">
            {store.addressLine}
            {store.suburb ? `, ${store.suburb}` : ""} {store.postcode}
          </p>
          <p className="mt-1">
            {booking.depositRefundable
              ? `Deposit refundable until ${store.refundWindowHours}h before pickup.`
              : "Deposit is non-refundable."}
          </p>
        </div>

        <div className="mt-7 flex flex-wrap gap-3">
          <Link href="/" className="btn-secondary">Back to the bakery</Link>
          {booking.status === "HELD" ? (
            <Link href="/book" className="btn-primary">Complete payment</Link>
          ) : null}
        </div>

        <div className="mt-5 flex items-center gap-2 text-xs text-muted">
          <PaymentStatusBadge status={booking.depositStatus} />
          <span>Payments secured by Stripe</span>
        </div>
      </div>
    </Shell>
  );
}

function Shell({ store, children }: { store: Awaited<ReturnType<typeof getStorefront>>; children: React.ReactNode }) {
  return (
    <main className="min-h-screen">
      <SiteHeader bakeryName={store.name} brandColor={store.brandColor} slug={store.slug} />
      <div className="container-page py-12">{children}</div>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-6">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}
