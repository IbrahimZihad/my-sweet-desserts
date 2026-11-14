"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { BookingAnnouncementDto, BookingAnnouncementsResponse } from "@cakeflow/contracts";

const STORAGE_KEY = "cf_announcements_enabled";
const POLL_MS = 10_000;

/**
 * Polls the admin API for new bookings and reads each one aloud through the
 * browser's speech synthesis engine. The preference is per device; the panel
 * must be opened once to satisfy the browser's audio-unlock rule.
 */
export function NewBookingAnnouncer({ timezone }: { timezone: string }) {
  const [mounted, setMounted] = useState(false);
  const [supported, setSupported] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [last, setLast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sinceRef = useRef<string>(new Date().toISOString());
  const seenRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    setMounted(true);
    const available = typeof window !== "undefined" && "speechSynthesis" in window;
    setSupported(available);
    if (!available) return;
    if (window.localStorage.getItem(STORAGE_KEY) === "1") {
      sinceRef.current = new Date().toISOString();
      setEnabled(true);
    }
  }, []);

  const speak = useCallback((text: string) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const synth = window.speechSynthesis;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-AU";
    utterance.rate = 1;
    utterance.pitch = 1;
    utterance.volume = 1; // full volume: this is a kitchen/back-office alert
    const voices = synth.getVoices();
    const voice =
      voices.find((item) => item.lang.toLowerCase() === "en-au") ??
      voices.find((item) => item.lang.toLowerCase().startsWith("en"));
    if (voice) utterance.voice = voice;
    synth.speak(utterance);
  }, []);

  useEffect(() => {
    if (!enabled || !supported) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      try {
        const response = await fetch(
          `/api/admin/announcements?since=${encodeURIComponent(sinceRef.current)}`,
          { cache: "no-store" },
        );
        if (!response.ok) {
          throw new Error(
            response.status === 401
              ? "Session expired — sign in again."
              : "Could not check for new bookings.",
          );
        }

        const data = (await response.json()) as BookingAnnouncementsResponse;
        if (stopped) return;

        for (const item of data.announcements) {
          if (seenRef.current.has(item.id)) continue;
          seenRef.current.add(item.id);
          speak(describe(item, timezone));
          setLast(`${item.reference} · ${item.customerName}`);
        }

        // Overlap slightly to absorb clock skew; IDs are deduplicated above.
        sinceRef.current = new Date(new Date(data.serverTime).getTime() - 2_000).toISOString();
        setError(null);
      } catch (caught) {
        if (!stopped) {
          setError(caught instanceof Error ? caught.message : "Announcements are paused.");
        }
      } finally {
        if (!stopped) timer = setTimeout(poll, POLL_MS);
      }
    };

    void poll();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [enabled, supported, speak, timezone]);

  function toggle() {
    if (!supported) return;
    const next = !enabled;
    setEnabled(next);
    window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");

    if (next) {
      sinceRef.current = new Date().toISOString();
      seenRef.current.clear();
      setError(null);
      speak("Booking announcements enabled. New bookings will be read aloud.");
    } else {
      window.speechSynthesis.cancel();
      setLast(null);
    }
  }

  function test() {
    speak(
      "This is a test. New booking. Reference C F T E S T. Jane Doe. Vanilla bean celebration cake. Pickup Saturday at ten thirty.",
    );
  }

  if (!mounted) return null;

  return (
    <aside className="fixed bottom-4 right-4 z-50 w-[min(22rem,calc(100vw-2rem))] rounded-2xl border border-line bg-white p-4 shadow-soft">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted">Live</p>
          <p className="font-display text-lg leading-tight">Booking announcements</p>
        </div>
        <span
          aria-hidden
          className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${
            enabled ? "bg-emerald-500" : "bg-line"
          }`}
        />
      </div>

      <p className="mt-2 text-xs leading-5 text-muted">
        {!supported
          ? "This browser does not support speech synthesis. Try Chrome, Edge or Safari."
          : enabled
            ? "Listening for new bookings. Each one is read aloud at full volume on this device."
            : "Enable to hear each new booking read aloud through this device's speaker."}
      </p>

      {last && enabled ? (
        <p aria-live="polite" className="mt-2 text-xs font-medium text-ink">
          Last announced: {last}
        </p>
      ) : null}

      {error ? <p className="mt-2 text-xs text-red-700">{error}</p> : null}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={toggle}
          disabled={!supported}
          className={enabled ? "btn-secondary" : "btn-primary"}
        >
          {enabled ? "Mute announcements" : "Enable announcements"}
        </button>
        <button
          type="button"
          onClick={test}
          disabled={!supported || !enabled}
          className="btn-secondary"
        >
          Test voice
        </button>
      </div>
    </aside>
  );
}

function describe(item: BookingAnnouncementDto, timezone: string): string {
  const when = new Intl.DateTimeFormat("en-AU", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  }).format(new Date(item.slotStartsAt));

  const spokenReference = item.reference
    .replace(/-/g, " ")
    .split("")
    .filter((character) => character !== " ")
    .join(" ");
  const kind = item.status === "CONFIRMED" ? "Confirmed booking" : "New booking";

  return `${kind}. Reference ${spokenReference}. ${item.customerName}. ${item.cakeName}. Pickup ${when}.`;
}
