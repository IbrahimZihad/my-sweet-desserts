import Link from "next/link";
import type { BookingSummaryDto } from "@cakeflow/contracts";
import { adminApi } from "@/lib/admin";
import { BookingsTable } from "@/components/admin/BookingsTable";

export const dynamic = "force-dynamic";

interface BookingList {
  total: number;
  page: number;
  pageSize: number;
  rows: Array<BookingSummaryDto & { balanceDueCents: number }>;
}

const STATUSES = ["", "HELD", "CONFIRMED", "CANCELLED", "EXPIRED", "COMPLETED"] as const;

export default async function AdminBookingsPage({
  searchParams,
}: {
  searchParams: { status?: string; search?: string; page?: string };
}) {
  const page = Math.max(Number(searchParams.page ?? "1") || 1, 1);
  const query = new URLSearchParams({ page: String(page), pageSize: "25" });
  if (searchParams.status) query.set("status", searchParams.status);
  if (searchParams.search) query.set("search", searchParams.search);

  const bookings = await adminApi<BookingList>(`/v1/admin/bookings?${query}`);
  const totalPages = Math.max(1, Math.ceil(bookings.total / bookings.pageSize));

  return (
    <div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">Ledger</p>
        <h1 className="mt-1 font-display text-3xl">Bookings</h1>
      </div>

      <form className="mt-6 flex flex-wrap items-end gap-3" action="/admin/bookings">
        <div>
          <label className="label" htmlFor="search">Search</label>
          <input
            id="search"
            name="search"
            defaultValue={searchParams.search ?? ""}
            placeholder="Reference, name or email"
            className="input w-64"
          />
        </div>
        <div>
          <label className="label" htmlFor="status">Status</label>
          <select id="status" name="status" defaultValue={searchParams.status ?? ""} className="input w-40">
            {STATUSES.map((status) => (
              <option key={status || "all"} value={status}>
                {status ? status.replace("_", " ") : "All statuses"}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn-primary">Filter</button>
        <Link href="/admin/bookings" className="pb-3 text-sm text-muted underline-offset-4 hover:underline">
          Reset
        </Link>
      </form>

      <p className="mt-5 text-sm text-muted">
        {bookings.total} booking{bookings.total === 1 ? "" : "s"} · page {bookings.page} of {totalPages}
      </p>

      <div className="mt-3">
        <BookingsTable rows={bookings.rows} timezone="Australia/Melbourne" allowCancel />
      </div>

      <div className="mt-5 flex items-center justify-between text-sm">
        <Link
          href={`/admin/bookings?${new URLSearchParams({
            ...(searchParams.status ? { status: searchParams.status } : {}),
            ...(searchParams.search ? { search: searchParams.search } : {}),
            page: String(Math.max(1, page - 1)),
          })}`}
          className={`btn-secondary ${page <= 1 ? "pointer-events-none opacity-40" : ""}`}
        >
          Previous
        </Link>
        <Link
          href={`/admin/bookings?${new URLSearchParams({
            ...(searchParams.status ? { status: searchParams.status } : {}),
            ...(searchParams.search ? { search: searchParams.search } : {}),
            page: String(Math.min(totalPages, page + 1)),
          })}`}
          className={`btn-secondary ${page >= totalPages ? "pointer-events-none opacity-40" : ""}`}
        >
          Next
        </Link>
      </div>
    </div>
  );
}
