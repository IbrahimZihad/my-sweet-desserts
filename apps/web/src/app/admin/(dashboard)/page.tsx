import Link from "next/link";
import { adminApi } from "@/lib/admin";
import { formatMoney } from "@/lib/format";
import type { BookingSummaryDto } from "@cakeflow/contracts";
import { BookingsTable } from "@/components/admin/BookingsTable";

export const dynamic = "force-dynamic";

interface Stats {
  todaysBookings: number;
  pendingDeposits: number;
  depositRevenueCents: number;
  upcomingBookings: number;
}

interface BookingList {
  total: number;
  rows: Array<BookingSummaryDto & { balanceDueCents: number }>;
}

export default async function AdminOverviewPage() {
  const [stats, recent] = await Promise.all([
    adminApi<Stats>("/v1/admin/stats"),
    adminApi<BookingList>("/v1/admin/bookings?page=1&pageSize=8"),
  ]);

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">Today</p>
          <h1 className="mt-1 font-display text-3xl">Bakery overview</h1>
        </div>
        <Link href="/admin/slots" className="btn-secondary">
          Manage pickup capacity
        </Link>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Pickups today" value={String(stats.todaysBookings)} hint="Confirmed + held" />
        <StatCard label="Upcoming" value={String(stats.upcomingBookings)} hint="Confirmed, future" />
        <StatCard label="Deposits pending" value={String(stats.pendingDeposits)} hint="Awaiting payment" tone="amber" />
        <StatCard
          label="Deposit revenue"
          value={formatMoney(stats.depositRevenueCents)}
          hint="Captured, all time"
          tone="green"
        />
      </div>

      <section className="mt-8">
        <div className="mb-4 flex items-end justify-between">
          <h2 className="font-display text-xl">Latest bookings</h2>
          <Link href="/admin/bookings" className="text-sm text-muted underline-offset-4 hover:text-ink hover:underline">
            View all {recent.total}
          </Link>
        </div>
        <BookingsTable rows={recent.rows} timezone="Australia/Melbourne" compact />
      </section>

      <p className="mt-6 text-xs text-muted">
        All times shown in the bakery timezone. Deposit refunds follow your policy window.
      </p>
    </div>
  );
}

function StatCard({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  hint: string;
  tone?: "default" | "amber" | "green";
}) {
  const accent =
    tone === "amber" ? "text-amber-700" : tone === "green" ? "text-emerald-700" : "text-ink";
  return (
    <div className="card p-5">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className={`mt-2 font-display text-3xl ${accent}`}>{value}</p>
      <p className="mt-1 text-xs text-muted">{hint}</p>
    </div>
  );
}
