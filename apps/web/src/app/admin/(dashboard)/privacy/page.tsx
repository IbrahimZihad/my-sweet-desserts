import type { PrivacyRequestSummaryDto } from "@cakeflow/contracts";
import { adminApi } from "@/lib/admin";
import { getAdminSession } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

interface RequestList {
  total: number;
  page: number;
  pageSize: number;
  rows: PrivacyRequestSummaryDto[];
}

export default async function AdminPrivacyPage() {
  const session = await getAdminSession();
  if (!session) return null;

  if (session.role !== "OWNER") {
    return (
      <div className="card p-8">
        <h1 className="font-display text-2xl">Owner access required</h1>
        <p className="mt-2 text-sm text-muted">
          Data-subject request records are restricted to the bakery owner.
        </p>
      </div>
    );
  }

  const requests = await adminApi<RequestList>("/v1/admin/privacy/requests?page=1&pageSize=50");

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">Compliance</p>
          <h1 className="mt-1 font-display text-3xl">Privacy requests</h1>
        </div>
        <p className="max-w-md text-xs leading-5 text-muted">
          Every export and erasure request is recorded here. Customer emails are stored as one-way
          hashes, so this page cannot be used to rebuild a contact list.
        </p>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <InfoCard
          label="Retention window"
          value="730 days"
          hint="Closed bookings are anonymised after this period."
        />
        <InfoCard
          label="Erasure method"
          value="Anonymise"
          hint="PII is replaced; the financial ledger is retained."
        />
        <InfoCard
          label="Requests on record"
          value={String(requests.total)}
          hint="Exports and erasures across all time."
        />
      </div>

      <div className="mt-8">
        <h2 className="font-display text-xl">Request log</h2>
        {requests.rows.length === 0 ? (
          <div className="card mt-3 p-8 text-center text-sm text-muted">
            No data-subject requests yet.
          </div>
        ) : (
          <div className="card mt-3 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="border-b border-line bg-cream/60 text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-4 py-3 font-medium">Type</th>
                    <th className="px-4 py-3 font-medium">Reference</th>
                    <th className="px-4 py-3 font-medium">Subject hash</th>
                    <th className="px-4 py-3 font-medium">Requested</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {requests.rows.map((row) => (
                    <tr key={row.id} className="hover:bg-cream/40">
                      <td className="px-4 py-3">
                        <span className="badge bg-cream text-ink">{row.type}</span>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">{row.reference}</td>
                      <td className="px-4 py-3 font-mono text-xs text-muted">
                        {row.subjectEmailHashPrefix}…
                      </td>
                      <td className="px-4 py-3 text-xs text-muted">
                        {formatDateTime(row.requestedAt, "Australia/Melbourne")}
                      </td>
                      <td className="px-4 py-3">
                        <span className="badge bg-emerald-50 text-emerald-800">{row.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <section className="card mt-8 p-6 text-sm leading-6 text-muted">
        <h2 className="font-display text-xl text-ink">How retention runs</h2>
        <p className="mt-2">
          A nightly job anonymises closed bookings older than the retention window and redacts Stripe
          webhook payloads after 30 days. Financial records (amounts, references, payment identifiers and
          timestamps) are kept for tax and accounting purposes. The retention job is idempotent and can be
          re-run safely.
        </p>
        <p className="mt-2">
          The customer-facing notice, cookie policy and self-service request form live at{" "}
          <a href="/privacy" className="text-ink underline underline-offset-4">/privacy</a>,{" "}
          <a href="/cookies" className="text-ink underline underline-offset-4">/cookies</a> and{" "}
          <a href="/privacy/request" className="text-ink underline underline-offset-4">/privacy/request</a>.
        </p>
      </section>
    </div>
  );
}

function InfoCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="card p-5">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-2 font-display text-3xl">{value}</p>
      <p className="mt-1 text-xs text-muted">{hint}</p>
    </div>
  );
}
