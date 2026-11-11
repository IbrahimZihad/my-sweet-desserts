import { adminApi } from "@/lib/admin";
import { CapacityInput } from "@/components/admin/CapacityInput";
import { GenerateSlotsForm } from "@/components/admin/GenerateSlotsForm";
import { formatSlot, todayInZone } from "@/lib/format";

export const dynamic = "force-dynamic";

interface AdminSlot {
  id: string;
  startsAt: string;
  endsAt: string;
  serviceDate: string;
  capacity: number;
  bookedCount: number;
  status: "OPEN" | "CLOSED";
  priceOverrideCents: number | null;
}

export default async function AdminSlotsPage() {
  const timezone = "Australia/Melbourne";
  const from = todayInZone(timezone);
  const to = new Date(Date.now() + 21 * 86_400_000).toISOString().slice(0, 10);
  const slots = await adminApi<AdminSlot[]>(
    `/v1/admin/slots?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
  );

  const grouped = new Map<string, AdminSlot[]>();
  for (const slot of slots) {
    const key = slot.serviceDate.slice(0, 10);
    const list = grouped.get(key) ?? [];
    list.push(slot);
    grouped.set(key, list);
  }

  return (
    <div className="space-y-8">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">Capacity</p>
        <h1 className="mt-1 font-display text-3xl">Pickup slots</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          One booking consumes one unit of capacity. Lowering capacity below the number of booked cakes is
          blocked by the API, so you can never oversell a window.
        </p>
      </div>

      <GenerateSlotsForm />

      <section>
        <h2 className="font-display text-xl">Next 21 days</h2>
        {slots.length === 0 ? (
          <div className="card mt-3 p-8 text-sm text-muted">
            No slots in this window. Generate some above.
          </div>
        ) : (
          <div className="mt-3 space-y-4">
            {[...grouped.entries()].map(([date, daySlots]) => (
              <div key={date} className="card overflow-hidden">
                <div className="flex items-center justify-between border-b border-line bg-cream/60 px-5 py-3">
                  <p className="text-sm font-semibold">
                    {formatSlot(daySlots[0]!.startsAt, timezone).date}
                  </p>
                  <p className="text-xs text-muted">
                    {daySlots.reduce((sum, slot) => sum + slot.bookedCount, 0)} booked /{" "}
                    {daySlots.reduce((sum, slot) => sum + slot.capacity, 0)} capacity
                  </p>
                </div>
                <div className="divide-y divide-line">
                  {daySlots.map((slot) => (
                    <div key={slot.id} className="flex flex-wrap items-center gap-4 px-5 py-3 text-sm">
                      <p className="w-24 font-medium">{formatSlot(slot.startsAt, timezone).time}</p>
                      <p className="w-24 text-xs text-muted">
                        {slot.bookedCount} booked
                      </p>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted">Capacity</span>
                        <CapacityInput slotId={slot.id} capacity={slot.capacity} booked={slot.bookedCount} />
                      </div>
                      <span
                        className={`badge ml-auto ${
                          slot.status === "OPEN"
                            ? "bg-emerald-50 text-emerald-800"
                            : "bg-stone-100 text-stone-600"
                        }`}
                      >
                        {slot.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
