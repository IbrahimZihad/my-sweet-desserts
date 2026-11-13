"use client";

import { useState } from "react";
import type {
  ApiErrorBody,
  PrivacyEraseResponse,
  PrivacyExportResponse,
} from "@cakeflow/contracts";

type Mode = "export" | "erase";

export function PrivacyRequestForm() {
  const [mode, setMode] = useState<Mode>("export");
  const [form, setForm] = useState({ email: "", reference: "", reason: "" });
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exported, setExported] = useState(false);
  const [erased, setErased] = useState<PrivacyEraseResponse | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setExported(false);
    setErased(null);

    if (mode === "erase" && !confirm) {
      setError("Please confirm that you understand erasure is irreversible.");
      return;
    }

    setBusy(true);
    try {
      const response = await fetch(`/api/privacy/${mode}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: form.email.trim(),
          reference: form.reference.trim(),
          ...(mode === "erase" ? { confirm: true, reason: form.reason.trim() || undefined } : {}),
        }),
      });

      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error((payload as ApiErrorBody | null)?.message ?? "The request could not be completed.");
      }

      if (mode === "export") {
        const data = payload as PrivacyExportResponse;
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `cakeflow-data-export-${data.orders[0]?.reference ?? form.reference.trim()}.json`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);
        setExported(true);
      } else {
        setErased(payload as PrivacyEraseResponse);
        setConfirm(false);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The request could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-6 sm:p-8">
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Privacy request type">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "export"}
          onClick={() => setMode("export")}
          className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
            mode === "export" ? "bg-ink text-cream" : "border border-line bg-white text-muted hover:text-ink"
          }`}
        >
          Download my data
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "erase"}
          onClick={() => setMode("erase")}
          className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
            mode === "erase" ? "bg-ink text-cream" : "border border-line bg-white text-muted hover:text-ink"
          }`}
        >
          Erase my data
        </button>
      </div>

      <p className="mt-4 text-sm leading-6 text-muted">
        For your security, we verify the request against the email address and booking reference used
        for the booking. We respond immediately for exports; erasure is processed immediately while
        retaining only the financial records we are legally required to keep.
      </p>

      <form onSubmit={submit} className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="label" htmlFor="privacy-email">
            Email used for the booking
          </label>
          <input
            id="privacy-email"
            type="email"
            className="input"
            autoComplete="email"
            value={form.email}
            onChange={(event) => setForm({ ...form, email: event.target.value })}
            required
          />
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="privacy-reference">
            Booking reference
          </label>
          <input
            id="privacy-reference"
            className="input font-mono"
            placeholder="CF-XXXXXX"
            value={form.reference}
            onChange={(event) => setForm({ ...form, reference: event.target.value.toUpperCase() })}
            required
            minLength={6}
            maxLength={24}
          />
        </div>

        {mode === "erase" ? (
          <>
            <div className="sm:col-span-2">
              <label className="label" htmlFor="privacy-reason">
                Reason <span className="font-normal text-muted">(optional)</span>
              </label>
              <textarea
                id="privacy-reason"
                className="input min-h-20 resize-y"
                maxLength={500}
                value={form.reason}
                onChange={(event) => setForm({ ...form, reason: event.target.value })}
                placeholder="You do not need to give a reason, but it helps us improve."
              />
            </div>
            <label className="flex items-start gap-3 rounded-xl bg-red-50 p-4 text-sm text-red-800 sm:col-span-2">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 accent-ink"
                checked={confirm}
                onChange={(event) => setConfirm(event.target.checked)}
              />
              <span>
                I understand that erasure is irreversible. My name, email, phone and notes will be
                removed, and I will not be able to look up these bookings with my email afterwards.
              </span>
            </label>
          </>
        ) : null}

        {error ? (
          <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 sm:col-span-2">
            {error}
          </p>
        ) : null}

        {exported ? (
          <p role="status" className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800 sm:col-span-2">
            Your export has been downloaded. Keep the file somewhere safe — it contains your personal
            data.
          </p>
        ) : null}

        {erased ? (
          <div role="status" className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-900 sm:col-span-2">
            <p className="font-semibold">Your data has been erased.</p>
            <p className="mt-1">Confirmation: <span className="font-mono">{erased.confirmationId}</span></p>
            <p className="mt-1">Anonymised bookings: {erased.anonymisedOrders}</p>
            <p className="mt-2 text-emerald-800">{erased.retained}</p>
          </div>
        ) : null}

        <div className="sm:col-span-2">
          <button type="submit" className="btn-primary w-full py-3.5" disabled={busy}>
            {busy
              ? "Working…"
              : mode === "export"
                ? "Download my data"
                : "Permanently erase my personal data"}
          </button>
        </div>
      </form>
    </div>
  );
}
