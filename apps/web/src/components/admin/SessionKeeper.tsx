"use client";

import { useEffect } from "react";

/**
 * Keeps the short-lived access cookie fresh while the dashboard is open.
 * Refreshing rotates the refresh token server-side and re-sets httpOnly cookies.
 */
export function SessionKeeper() {
  useEffect(() => {
    const refresh = () => {
      void fetch("/api/auth/refresh", { method: "POST" });
    };
    const interval = window.setInterval(refresh, 10 * 60_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return null;
}
