import type { OrderStatus, PaymentStatus } from "@cakeflow/contracts";

const ORDER_STYLES: Record<OrderStatus, string> = {
  HELD: "bg-amber-50 text-amber-800",
  PENDING_PAYMENT: "bg-amber-50 text-amber-800",
  CONFIRMED: "bg-emerald-50 text-emerald-800",
  CANCELLED: "bg-stone-100 text-stone-600",
  EXPIRED: "bg-stone-100 text-stone-600",
  COMPLETED: "bg-sky-50 text-sky-800",
};

const PAYMENT_STYLES: Record<PaymentStatus, string> = {
  REQUIRES_PAYMENT: "bg-amber-50 text-amber-800",
  PROCESSING: "bg-amber-50 text-amber-800",
  SUCCEEDED: "bg-emerald-50 text-emerald-800",
  FAILED: "bg-red-50 text-red-700",
  REFUNDED: "bg-sky-50 text-sky-800",
  PARTIALLY_REFUNDED: "bg-sky-50 text-sky-800",
  CANCELLED: "bg-stone-100 text-stone-600",
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return <span className={`badge ${ORDER_STYLES[status] ?? "bg-stone-100 text-stone-600"}`}>{status.replace("_", " ")}</span>;
}

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  return (
    <span className={`badge ${PAYMENT_STYLES[status] ?? "bg-stone-100 text-stone-600"}`}>
      {status.replace("_", " ")}
    </span>
  );
}
