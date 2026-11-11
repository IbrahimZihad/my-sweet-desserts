"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function GenerateSlotsForm() {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const twoWeeks = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);

  const [form, setForm] = useState({
    from: today,
    to: twoWeeks,
    weekdays: [2, 3, 4, 5, 6] as number[],
    startTime: "11:00",
    endTime: "17:00",
    durationMinutes: 45,
    capacity: 2,
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toggleWeekday = (day: number) => {
    setForm((current) => ({
      ...current,
      weekdays: current.weekdays.includes(day)
        ? current.weekdays.filter((value) => value !== day)
        : [...current.weekdays, day],
    }));
  };

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/slots/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      const payload = (await response.json()) as { created?: number; skipped?: number; message?: string };
      if (!response.ok) throw new Error(payload.message ?? "Could not generate slots.");
      setMessage(`Created ${payload.created ?? 0} slots (${payload.skipped ?? 0} already existed).`);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not generate slots.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card p-6">
      <h2 className="font-display text-xl">Generate pickup windows</h2>
      <p className="mt-1 text-sm text-muted">
        Creates one slot per time block, per selected weekday. Existing slots are skipped.
      </p>

      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="label" htmlFor="from">From</label>
          <input id="from" type="date" className="input" value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} required />
        </div>
        <div>
          <label className="label" htmlFor="to">To</label>
          <input id="to" type="date" className="input" value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} required />
        </div>
        <div>
          <label className="label" htmlFor="startTime">First window</label>
          <input id="startTime" type="time" className="input" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} required />
        </div>
        <div>
          <label className="label" htmlFor="endTime">Last window ends</label>
          <input id="endTime" type="time" className="input" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} required />
        </div>
        <div>
          <label className="label" htmlFor="duration">Slot length (min)</label>
          <input id="duration" type="number" min={15} max={480} step={15} className="input" value={form.durationMinutes} onChange={(e) => setForm({ ...form, durationMinutes: Number(e.target.value) })} required />
        </div>
        <div>
          <label className="label" htmlFor="capacity">Cakes per slot</label>
          <input id="capacity" type="number" min={1} max={200} className="input" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: Number(e.target.value) })} required />
        </div>
      </div>

      <fieldset className="mt-5">
        <legend className="label">Days</legend>
        <div className="flex flex-wrap gap-2">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((label, day) => (
            <button
              key={label}
              type="button"
              onClick={() => toggleWeekday(day)}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                form.weekdays.includes(day)
                  ? "border-ink bg-ink text-cream"
                  : "border-line bg-white text-muted hover:border-rose-300"
              }`}
              aria-pressed={form.weekdays.includes(day)}
            >
              {label}
            </button>
          ))}
        </div>
      </fieldset>

      {message ? <p className="mt-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{message}</p> : null}
      {error ? <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p> : null}

      <button type="submit" className="btn-primary mt-5" disabled={busy || form.weekdays.length === 0}>
        {busy ? "Generating…" : "Generate slots"}
      </button>
    </form>
  );
}
