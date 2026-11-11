import type { BookingSummaryDto } from "@cakeflow/contracts";
import { CancelBookingButton } from "./CancelBookingButton";
import { OrderStatusBadge, PaymentStatusBadge } from "./StatusBadge";
import { formatDateTime, formatMoney } from "@/lib/format";

export interface AdminBookingRow extends BookingSummaryDto {
  balanceDueCents: number;
}

export function BookingsTable({
  rows,
  timezone,
  compact = false,
  allowCancel = false,
}: {
  rows: AdminBookingRow[];
  timezone: string;
  compact?: boolean;
  allowCancel?: boolean;
}) {
  if (rows.length === 0) {
    return (
      <div className="card p-8 text-center text-sm text-muted">
        No bookings yet. Share your storefront link to get the first one.
      </div>
    );
  }

  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="border-b border-line bg-cream/60 text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-3 font-medium">Reference</th>
              <th className="px-4 py-3 font-medium">Customer</th>
              <th className="px-4 py-3 font-medium">Cake</th>
              <th className="px-4 py-3 font-medium">Pickup</th>
              <th className="px-4 py-3 font-medium">Deposit</th>
              <th className="px-4 py-3 font-medium">Status</th>
              {allowCancel ? <th className="px-4 py-3" /> : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((row) => (
              <tr key={row.id} className="align-top hover:bg-cream/40">
                <td className="px-4 py-3">
                  <span className="font-mono text-xs font-semibold">{row.reference}</span>
                  {!compact ? (
                    <p className="mt-1 text-[11px] text-muted">
                      {formatDateTime(row.createdAt, timezone)}
                    </p>
                  ) : null}
                </td>
                <td className="px-4 py-3">
                  <p className="font-medium">{row.customerName}</p>
                  <p className="text-xs text-muted">{row.customerEmail}</p>
                </td>
                <td className="px-4 py-3">
                  <p>{row.cakeName}</p>
                  {!compact ? (
                    <p className="text-xs text-muted">
                      Balance {formatMoney(row.balanceDueCents)}
                    </p>
                  ) : null}
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  {formatDateTime(row.slotStartsAt, timezone)}
                </td>
                <td className="px-4 py-3">
                  <p className="font-medium">{formatMoney(row.depositCents)}</p>
                  <div className="mt-1">
                    <PaymentStatusBadge status={row.depositStatus} />
                  </div>
                </td>
                <td className="px-4 py-3">
                  <OrderStatusBadge status={row.status} />
                  {!row.depositRefundable ? (
                    <p className="mt-1 text-[11px] text-muted">Non-refundable</p>
                  ) : null}
                </td>
                {allowCancel ? (
                  <td className="px-4 py-3">
                    {["HELD", "PENDING_PAYMENT", "CONFIRMED"].includes(row.status) ? (
                      <CancelBookingButton
                        orderId={row.id}
                        reference={row.reference}
                        paid={row.depositStatus === "SUCCEEDED"}
                      />
                    ) : null}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
