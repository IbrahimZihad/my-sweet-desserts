"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import type {
  AvailableSlotDto,
  AvailabilityResponse,
  BookingSummaryDto,
  CreateBookingResponse,
} from "@cakeflow/contracts";
import { formatMoney, formatSlot, todayInZone } from "@/lib/format";
import type { Storefront } from "@/lib/storefront";

type Phase = "choose" | "payment" | "confirming" | "done";

const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
const stripePromise = publishableKey ? loadStripe(publishableKey) : null;

export function BookingWizard({
  store,
  initialCakeId,
}: {
  store: Storefront;
  initialCakeId: string;
}) {
  const [phase, setPhase] = useState<Phase>("choose");
  const [cakeId, setCakeId] = useState(initialCakeId);
  const [date, setDate] = useState(todayInZone(store.timezone));
  const [slots, setSlots] = useState<AvailableSlotDto[]>([]);
  const [slotId, setSlotId] = useState("");
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", phone: "", notes: "" });
  const [accepted, setAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [booking, setBooking] = useState<CreateBookingResponse | null>(null);
  const [summary, setSummary] = useState<BookingSummaryDto | null>(null);
  // Created lazily: a new attempt after a failed/expired hold needs a fresh key,
  // otherwise the API would resume the dead order and answer 410 HOLD_EXPIRED.
  const idempotencyKey = useRef<string | null>(null);

  const cake = store.cakes.find((item) => item.id === cakeId);
  const selectedSlot = slots.find((item) => item.id === slotId);
  const today = todayInZone(store.timezone);
  const maxDate = useMemo(() => {
    // Anchor at midday UTC so DST shifts can never move the calendar day.
    const value = new Date(`${todayInZone(store.timezone)}T12:00:00Z`);
    value.setUTCDate(value.getUTCDate() + store.maxAdvanceDays);
    return value.toISOString().slice(0, 10);
  }, [store.maxAdvanceDays, store.timezone]);

  useEffect(() => {
    if (!cakeId) return;
    const controller = new AbortController();
    setLoadingSlots(true);
    setError(null);

    fetch(
      `/api/availability?from=${encodeURIComponent(date)}&to=${encodeURIComponent(date)}&cakeId=${encodeURIComponent(cakeId)}`,
      { signal: controller.signal },
    )
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load pickup times.");
        return (await response.json()) as AvailabilityResponse;
      })
      .then((data) => {
        setSlots(data.slots);
        setSlotId("");
      })
      .catch((caught: unknown) => {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setError(caught instanceof Error ? caught.message : "Could not load pickup times.");
      })
      .finally(() => setLoadingSlots(false));

    return () => controller.abort();
  }, [cakeId, date]);

  const depositCents = useMemo(() => {
    if (!cake) return 0;
    const total = selectedSlot?.priceCents ?? cake.priceCents;
    return store.depositType === "PERCENTAGE"
      ? Math.min(Math.max(Math.round((total * store.depositValue) / 10_000), 100), total)
      : Math.min(store.depositValue, total);
  }, [cake, selectedSlot, store.depositType, store.depositValue]);

  const refreshSummary = useCallback(
    async (reference: string) => {
      const response = await fetch(
        `/api/bookings/${encodeURIComponent(reference)}?email=${encodeURIComponent(form.email.trim())}`,
      );
      if (!response.ok) return null;
      const data = (await response.json()) as BookingSummaryDto;
      setSummary(data);
      return data;
    },
    [form.email],
  );

  const submit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      setError(null);

      if (!cakeId || !slotId) {
        setError("Choose a cake and pickup time first.");
        return;
      }
      if (!accepted) {
        setError("Please accept the deposit policy to continue.");
        return;
      }

      setSubmitting(true);
      const key = idempotencyKey.current ?? (idempotencyKey.current = crypto.randomUUID());
      try {
        const response = await fetch("/api/bookings", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": key,
          },
          body: JSON.stringify({
            cakeId,
            slotId,
            customer: {
              name: form.name.trim(),
              email: form.email.trim(),
              phone: form.phone.trim(),
            },
            notes: form.notes.trim() || undefined,
            acceptDepositPolicy: true,
          }),
        });

        const payload = (await response.json()) as CreateBookingResponse & {
          code?: string;
          message?: string;
        };
        if (!response.ok) {
          // The server already cancelled the hold for these codes, so resuming
          // the same idempotency key is pointless — start a clean attempt.
          if (
            payload.code === "HOLD_EXPIRED" ||
            payload.code === "PAYMENT_INTENT_UNAVAILABLE" ||
            payload.code === "PAYMENT_PROVIDER_ERROR"
          ) {
            idempotencyKey.current = null;
          }
          throw new Error(payload.message ?? "Booking could not be created.");
        }

        setBooking(payload);
        if (payload.status === "CONFIRMED") {
          await refreshSummary(payload.reference);
          setPhase("done");
        } else {
          setPhase("payment");
        }
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Booking could not be created.");
      } finally {
        setSubmitting(false);
      }
    },
    [accepted, cakeId, form, slotId, refreshSummary],
  );

  useEffect(() => {
    if (phase !== "confirming" || !booking) return;
    let cancelled = false;

    const poll = async () => {
      for (let attempt = 0; attempt < 25 && !cancelled; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        const data = await refreshSummary(booking.reference);
        if (cancelled) return;
        if (data?.status === "CONFIRMED") {
          setPhase("done");
          return;
        }
        if (data && ["CANCELLED", "EXPIRED"].includes(data.status)) {
          idempotencyKey.current = null;
          setError("The hold expired before payment completed. Please book again.");
          setPhase("choose");
          return;
        }
      }
      if (!cancelled) {
        setError(
          "Payment was received but confirmation is taking longer than usual. Check your email, or contact the bakery with your reference.",
        );
      }
    };

    void poll();
    return () => {
      cancelled = true;
    };
  }, [phase, booking, refreshSummary]);

  if (phase === "done" && booking) {
    return (
      <SuccessCard
        store={store}
        reference={booking.reference}
        startsAt={summary?.slotStartsAt ?? selectedSlot?.startsAt ?? ""}
        depositCents={booking.depositCents}
        totalCents={booking.totalCents}
      />
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1.35fr_0.65fr] lg:items-start">
      <form onSubmit={submit} className="card p-6 sm:p-8">
        <StepHeading number="01" title="Choose your cake" active={phase === "choose"} />
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {store.cakes.map((item) => {
            const selected = item.id === cakeId;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setCakeId(item.id);
                  setSlotId("");
                }}
                className={`rounded-2xl border p-4 text-left transition ${
                  selected ? "border-ink bg-rose-50" : "border-line bg-white hover:border-rose-300"
                }`}
                aria-pressed={selected}
              >
                <p className="text-sm font-semibold">{item.name}</p>
                <p className="mt-1 text-xs text-muted">
                  {item.sizeLabel} · serves {item.servings}
                </p>
                <p className="mt-2 text-sm font-semibold">{formatMoney(item.priceCents, store.currency)}</p>
              </button>
            );
          })}
        </div>

        <div className="my-7 h-px bg-line" />

        <StepHeading number="02" title="Pick a pickup window" active={phase === "choose"} />
        <div className="mt-4 max-w-xs">
          <label className="label" htmlFor="pickup-date">
            Pickup date
          </label>
          <input
            id="pickup-date"
            type="date"
            className="input"
            min={today}
            max={maxDate}
            value={date}
            onChange={(event) => {
              setDate(event.target.value);
              setSlotId("");
            }}
            required
          />
        </div>

        <div className="mt-4">
          {loadingSlots ? (
            <p className="text-sm text-muted">Loading pickup times…</p>
          ) : slots.length === 0 ? (
            <p className="rounded-xl bg-cream px-4 py-3 text-sm text-muted">
              No pickup windows on this date. Try another day.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {slots.map((slot) => {
                const selected = slot.id === slotId;
                const full = slot.remaining <= 0;
                return (
                  <button
                    key={slot.id}
                    type="button"
                    disabled={full}
                    onClick={() => setSlotId(slot.id)}
                    className={`rounded-full border px-4 py-2 text-sm transition ${
                      selected
                        ? "border-ink bg-ink text-cream"
                        : full
                          ? "cursor-not-allowed border-line bg-cream text-muted/50 line-through"
                          : "border-line bg-white hover:border-rose-300"
                    }`}
                  >
                    {formatSlot(slot.startsAt, store.timezone).time}
                    <span className="ml-2 text-[10px] uppercase tracking-wide opacity-70">
                      {full ? "full" : `${slot.remaining} left`}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="my-7 h-px bg-line" />

        <StepHeading number="03" title="Your details" active={phase === "choose"} />
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="name">
              Full name
            </label>
            <input
              id="name"
              className="input"
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              autoComplete="name"
              required
              minLength={2}
            />
          </div>
          <div>
            <label className="label" htmlFor="phone">
              Mobile
            </label>
            <input
              id="phone"
              className="input"
              value={form.phone}
              onChange={(event) => setForm({ ...form, phone: event.target.value })}
              autoComplete="tel"
              inputMode="tel"
              required
            />
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              className="input"
              value={form.email}
              onChange={(event) => setForm({ ...form, email: event.target.value })}
              autoComplete="email"
              required
            />
            <p className="mt-1 text-xs text-muted">Your confirmation and pickup details go here.</p>
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="notes">
              Anything the baker should know? <span className="font-normal text-muted">(optional)</span>
            </label>
            <textarea
              id="notes"
              className="input min-h-24 resize-y"
              value={form.notes}
              maxLength={500}
              onChange={(event) => setForm({ ...form, notes: event.target.value })}
              placeholder="Name on the cake, allergy notes, pickup running late…"
            />
          </div>
        </div>

        <label className="mt-5 flex items-start gap-3 rounded-xl bg-cream p-4 text-sm">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 accent-ink"
            checked={accepted}
            onChange={(event) => setAccepted(event.target.checked)}
          />
          <span className="text-muted">
            I understand this booking is held by a{" "}
            <strong className="text-ink">{formatMoney(depositCents, store.currency)} deposit</strong>
            {store.depositRefundable
              ? `, refundable until ${store.refundWindowHours}h before pickup.`
              : ", which is non-refundable."}{" "}
            The balance is paid at pickup.
          </span>
        </label>

        {error ? (
          <p role="alert" className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </p>
        ) : null}

        {phase === "choose" ? (
          <button type="submit" className="btn-primary mt-6 w-full py-3.5" disabled={submitting}>
            {submitting ? "Holding your slot…" : `Continue to deposit · ${formatMoney(depositCents, store.currency)}`}
          </button>
        ) : null}

        {phase === "payment" && booking ? (
          <div className="mt-6 border-t border-line pt-6">
            <div className="mb-4 flex items-baseline justify-between">
              <p className="font-display text-xl">Pay your deposit</p>
              <p className="text-sm text-muted">
                Held for {Math.max(0, Math.round((new Date(booking.holdExpiresAt).getTime() - Date.now()) / 60_000))} min
              </p>
            </div>
            {!stripePromise || !booking.clientSecret ? (
              <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
                Payment is not configured. Add NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY and try again.
              </p>
            ) : (
              <Elements
                stripe={stripePromise}
                options={{
                  clientSecret: booking.clientSecret,
                  appearance: {
                    theme: "stripe",
                    variables: {
                      colorPrimary: store.brandColor,
                      borderRadius: "12px",
                      fontFamily: "ui-sans-serif, system-ui, sans-serif",
                    },
                  },
                }}
              >
                <PaymentForm
                  email={form.email}
                  reference={booking.reference}
                  onPaid={() => setPhase("confirming")}
                  onError={setError}
                />
              </Elements>
            )}
          </div>
        ) : null}

        {phase === "confirming" ? (
          <div className="mt-6 rounded-xl bg-rose-50 px-4 py-5 text-sm text-ink">
            <p className="font-semibold">Payment received — confirming your slot…</p>
            <p className="mt-1 text-muted">
              This usually takes a few seconds. Keep this page open; we&apos;ll show your booking reference when
              it&apos;s done.
            </p>
          </div>
        ) : null}
      </form>

      <aside className="card p-6 lg:sticky lg:top-6">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">Your booking</p>
        <dl className="mt-4 space-y-3 text-sm">
          <Row label="Cake" value={cake ? `${cake.name} · ${cake.sizeLabel}` : "Not selected"} />
          <Row
            label="Pickup"
            value={
              selectedSlot
                ? `${formatSlot(selectedSlot.startsAt, store.timezone).date} at ${
                    formatSlot(selectedSlot.startsAt, store.timezone).time
                  }`
                : "Not selected"
            }
          />
          <Row label="Cake total" value={cake ? formatMoney(cake.priceCents, store.currency) : "—"} />
          <Row label="Deposit today" value={formatMoney(depositCents, store.currency)} strong />
          <Row
            label="Balance at pickup"
            value={
              cake && selectedSlot
                ? formatMoney((selectedSlot.priceCents ?? cake.priceCents) - depositCents, store.currency)
                : "—"
            }
          />
        </dl>
        <div className="mt-5 rounded-xl bg-cream p-4 text-xs leading-5 text-muted">
          <p className="font-semibold text-ink">{store.name}</p>
          <p className="mt-1">
            {store.addressLine}
            {store.suburb ? `, ${store.suburb}` : ""} {store.postcode}
          </p>
          <p className="mt-1">Pickup only · {store.timezone.replace("_", " ")}</p>
        </div>
      </aside>
    </div>
  );
}

function StepHeading({ number, title, active }: { number: string; title: string; active: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <span
        className={`grid h-7 w-7 place-items-center rounded-full text-[11px] font-bold ${
          active ? "bg-ink text-cream" : "bg-cream text-muted"
        }`}
      >
        {number}
      </span>
      <h2 className="font-display text-xl">{title}</h2>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="text-muted">{label}</dt>
      <dd className={`text-right ${strong ? "font-semibold" : ""}`}>{value}</dd>
    </div>
  );
}

function PaymentForm({
  email,
  reference,
  onPaid,
  onError,
}: {
  email: string;
  reference: string;
  onPaid: () => void;
  onError: (message: string) => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [paying, setPaying] = useState(false);

  async function pay(event: React.FormEvent) {
    event.preventDefault();
    if (!stripe || !elements) return;
    setPaying(true);
    onError("");

    const result = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}/booking/${encodeURIComponent(reference)}?email=${encodeURIComponent(email)}`,
        receipt_email: email,
      },
      redirect: "if_required",
    });

    if (result.error) {
      onError(result.error.message ?? "Payment failed. Please try another card.");
      setPaying(false);
      return;
    }
    if (result.paymentIntent?.status === "succeeded" || result.paymentIntent?.status === "processing") {
      onPaid();
      return;
    }
    setPaying(false);
  }

  return (
    <form onSubmit={pay}>
      <PaymentElement />
      <button type="submit" className="btn-primary mt-5 w-full py-3.5" disabled={!stripe || paying}>
        {paying ? "Processing…" : "Pay deposit securely"}
      </button>
      <p className="mt-3 text-center text-[11px] text-muted">
        Payments are processed by Stripe. CakeFlow never stores your card details.
      </p>
    </form>
  );
}

function SuccessCard({
  store,
  reference,
  startsAt,
  depositCents,
  totalCents,
}: {
  store: Storefront;
  reference: string;
  startsAt: string;
  depositCents: number;
  totalCents: number;
}) {
  const when = startsAt ? formatSlot(startsAt, store.timezone) : null;
  return (
    <div className="card mx-auto max-w-2xl p-8 text-center sm:p-10">
      <div
        className="mx-auto grid h-14 w-14 place-items-center rounded-full text-2xl text-white"
        style={{ backgroundColor: store.brandColor }}
      >
        ✓
      </div>
      <h2 className="mt-5 font-display text-3xl">You&apos;re booked in</h2>
      <p className="mt-2 text-sm text-muted">
        A confirmation email is on its way. Bring your reference to pickup.
      </p>

      <div className="mx-auto mt-6 max-w-sm rounded-2xl bg-cream p-5 text-left text-sm">
        <div className="flex justify-between">
          <span className="text-muted">Reference</span>
          <span className="font-mono font-semibold">{reference}</span>
        </div>
        <div className="mt-2 flex justify-between">
          <span className="text-muted">Pickup</span>
          <span className="font-semibold">
            {when ? `${when.date} · ${when.time}` : "See confirmation email"}
          </span>
        </div>
        <div className="mt-2 flex justify-between">
          <span className="text-muted">Deposit paid</span>
          <span className="font-semibold">{formatMoney(depositCents, store.currency)}</span>
        </div>
        <div className="mt-2 flex justify-between">
          <span className="text-muted">Balance at pickup</span>
          <span className="font-semibold">{formatMoney(totalCents - depositCents, store.currency)}</span>
        </div>
      </div>

      <div className="mt-7 flex flex-wrap justify-center gap-3">
        <Link href="/" className="btn-secondary">
          Back to the bakery
        </Link>
        <Link href="/book" className="btn-primary">
          Book another cake
        </Link>
      </div>
    </div>
  );
}
