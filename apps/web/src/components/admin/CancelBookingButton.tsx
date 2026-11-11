"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function CancelBookingButton({
  orderId,
  reference,
  paid,
}: {
  orderId: string;
  reference: string;
  paid: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cancel() {
    const refund = paid
      ? window.confirm(
          `Cancel ${reference} and refund the deposit?\n\nOK = refund, Cancel = keep deposit.`,
        )
      : true;
    if (!paid && !window.confirm(`Cancel booking ${reference}?`)) return;

    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/bookings/${orderId}/cancel`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "Cancelled from dashboard", refund: paid ? refund : false }),
      });
      const payload = (await response.json()) as { message?: string };
      if (!response.ok) throw new Error(payload.message ?? "Could not cancel booking.");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not cancel booking.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="text-right">
      <button
        type="button"
        onClick={cancel}
        disabled={busy}
        className="text-xs font-semibold text-rose-700 underline-offset-4 hover:underline disabled:opacity-50"
      >
        {busy ? "Cancelling…" : "Cancel"}
      </button>
      {error ? <p className="mt-1 max-w-40 text-[11px] text-red-600">{error}</p> : null}
    </div>
  );
}
