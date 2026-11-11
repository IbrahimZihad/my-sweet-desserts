"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function CapacityInput({ slotId, capacity, booked }: { slotId: string; capacity: number; booked: number }) {
  const router = useRouter();
  const [value, setValue] = useState(capacity);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (value === capacity) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/slots/${slotId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ capacity: value }),
      });
      const payload = (await response.json()) as { message?: string };
      if (!response.ok) throw new Error(payload.message ?? "Could not update capacity.");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update capacity.");
      setValue(capacity);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <input
        type="number"
        min={Math.max(booked, 1)}
        max={200}
        value={value}
        disabled={busy}
        onChange={(event) => setValue(Number(event.target.value))}
        onBlur={save}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void save();
          }
        }}
        className="w-20 rounded-lg border border-line bg-white px-2 py-1 text-sm focus:border-rose-500 focus:outline-none"
        aria-label="Capacity"
      />
      {error ? <p className="mt-1 text-[11px] text-red-600">{error}</p> : null}
    </div>
  );
}
