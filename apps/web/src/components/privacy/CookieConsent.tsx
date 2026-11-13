"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const CONSENT_COOKIE = "cf_consent";

interface ConsentChoice {
  v: 1;
  essential: true;
  analytics: false;
  ts: string;
}

/**
 * Essential-only cookie notice.
 *
 * CakeFlow currently sets no analytics or advertising cookies, so the notice is
 * a transparency record rather than a consent gate. The preference is stored in
 * a first-party cookie so it survives navigation and can be changed later from
 * the cookie policy page.
 */
export function CookieConsent() {
  const [visible, setVisible] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    if (!readConsent()) setVisible(true);

    const open = () => setVisible(true);
    window.addEventListener("cf:cookie-settings", open);
    return () => window.removeEventListener("cf:cookie-settings", open);
  }, []);

  if (!mounted || !visible) return null;

  function acceptEssential() {
    const choice: ConsentChoice = {
      v: 1,
      essential: true,
      analytics: false,
      ts: new Date().toISOString(),
    };
    document.cookie = `${CONSENT_COOKIE}=${encodeURIComponent(JSON.stringify(choice))}; Path=/; Max-Age=31536000; SameSite=Lax`;
    setVisible(false);
  }

  return (
    <div
      role="dialog"
      aria-label="Cookie notice"
      aria-live="polite"
      className="fixed inset-x-4 bottom-4 z-[60] mx-auto max-w-3xl rounded-2xl border border-line bg-white p-4 shadow-soft sm:p-5"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm leading-6 text-muted">
          <p className="font-semibold text-ink">Cookies on this site</p>
          <p className="mt-1">
            We use only essential cookies for secure sign-in, your booking session and remembering this
            choice. We do not use advertising or analytics cookies.{" "}
            <Link href="/cookies" className="text-ink underline underline-offset-4">
              Cookie policy
            </Link>
            {" · "}
            <Link href="/privacy" className="text-ink underline underline-offset-4">
              Privacy notice
            </Link>
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button type="button" onClick={acceptEssential} className="btn-primary whitespace-nowrap">
            Essential only
          </button>
          <Link href="/cookies" className="btn-secondary whitespace-nowrap">
            Details
          </Link>
        </div>
      </div>
    </div>
  );
}

function readConsent(): boolean {
  const match = document.cookie
    .split("; ")
    .find((row) => row.startsWith(`${CONSENT_COOKIE}=`));
  if (!match) return false;
  try {
    const parsed = JSON.parse(decodeURIComponent(match.slice(CONSENT_COOKIE.length + 1))) as ConsentChoice;
    return parsed?.v === 1 && parsed.essential === true;
  } catch {
    return false;
  }
}
