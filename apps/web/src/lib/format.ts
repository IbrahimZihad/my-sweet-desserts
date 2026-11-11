export function formatMoney(cents: number, currency = "AUD"): string {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency,
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

export function formatSlot(iso: string, timezone: string): { date: string; time: string } {
  const value = new Date(iso);
  return {
    date: new Intl.DateTimeFormat("en-AU", {
      weekday: "short",
      day: "numeric",
      month: "short",
      timeZone: timezone,
    }).format(value),
    time: new Intl.DateTimeFormat("en-AU", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: timezone,
    }).format(value),
  };
}

export function formatDateTime(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-AU", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone,
  }).format(new Date(iso));
}

export function todayInZone(timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: timezone,
  }).format(new Date());
}
