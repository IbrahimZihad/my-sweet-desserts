import Link from "next/link";
import { PRIVACY_POLICY_EFFECTIVE_DATE } from "@cakeflow/contracts";
import { LegalShell } from "@/components/privacy/LegalShell";
import { PrivacyRequestForm } from "@/components/privacy/PrivacyRequestForm";
import { getStorefront } from "@/lib/storefront.server";

export const dynamic = "force-dynamic";

export default async function PrivacyRequestPage() {
  const store = await getStorefront();
  const privacyEmail = process.env.PRIVACY_CONTACT_EMAIL ?? store.email ?? "privacy@cakeflow.example";

  return (
    <LegalShell store={store} title="Your data" updated={PRIVACY_POLICY_EFFECTIVE_DATE}>
      <p>
        You can download a copy of the personal data we hold about you, or ask us to erase it. Both
        requests are verified against your booking reference and the email address you used for the
        booking — the same pair needed to look up a booking.
      </p>

      <PrivacyRequestForm />

      <h2>What happens next</h2>
      <ul>
        <li>
          <strong>Export:</strong> the JSON file downloads immediately. It includes your profile, booking
          details, consent timestamps and payment metadata. It does not include card numbers, because we
          never receive them.
        </li>
        <li>
          <strong>Erasure:</strong> we replace your name, email, phone and notes with anonymised values,
          delete queued emails and deactivate the customer record. We keep order totals, references,
          payment identifiers and timestamps because tax and accounting law requires them. The response
          includes a confirmation ID.
        </li>
        <li>
          <strong>Upcoming bookings:</strong> we cannot erase data needed to fulfil a booking that has not
          happened yet. Cancel the booking first, or request erasure after pickup.
        </li>
      </ul>

      <h2>Other rights</h2>
      <p>
        To correct inaccurate data, restrict processing, object to processing, withdraw consent or ask a
        question, email <a href={`mailto:${privacyEmail}`}>{privacyEmail}</a>. We normally respond within
        one month. You also have the right to complain to your local supervisory authority — see the{" "}
        <Link href="/privacy">privacy notice</Link> for details.
      </p>

      <h2>Not sure what we hold?</h2>
      <p>
        Start with the export. If you no longer have your booking reference, email us with the address you
        used and we will help you locate it after verifying your identity.
      </p>
    </LegalShell>
  );
}
