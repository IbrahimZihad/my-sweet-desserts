import Link from "next/link";
import {
  PRIVACY_POLICY_EFFECTIVE_DATE,
  PRIVACY_POLICY_VERSION,
} from "@cakeflow/contracts";
import { LegalShell } from "@/components/privacy/LegalShell";
import { getStorefront } from "@/lib/storefront.server";

export const dynamic = "force-dynamic";

export default async function PrivacyPage() {
  const store = await getStorefront();
  const controller = store.legalName ?? store.name;
  const privacyEmail =
    process.env.PRIVACY_CONTACT_EMAIL ?? store.email ?? "privacy@cakeflow.example";
  const dpoEmail = process.env.PRIVACY_DPO_EMAIL;

  return (
    <LegalShell store={store} title="Privacy notice" updated={PRIVACY_POLICY_EFFECTIVE_DATE}>
      <p>
        This notice explains how <strong>{controller}</strong> (“we”, “us”) handles personal data when
        you use the {store.name} booking website. It is written to meet the EU General Data Protection
        Regulation (GDPR), the UK GDPR and comparable Australian privacy expectations. Version{" "}
        {PRIVACY_POLICY_VERSION}.
      </p>

      <h2>1. Who is responsible for your data</h2>
      <p>
        <strong>{controller}</strong> is the data controller for the booking and customer data described
        here. Our contact address is{" "}
        {[store.addressLine, store.suburb, store.postcode].filter(Boolean).join(", ") || "available on request"}
        , and our privacy contact is{" "}
        <a href={`mailto:${privacyEmail}`}>{privacyEmail}</a>.
      </p>
      <p>
        The CakeFlow software platform is operated by the CakeFlow service provider as our data
        processor. It hosts the booking system, sends transactional email and integrates with Stripe for
        payments. The processor only acts on our instructions and is bound by a data-processing
        agreement.
      </p>
      {dpoEmail ? (
        <p>
          Data protection officer: <a href={`mailto:${dpoEmail}`}>{dpoEmail}</a>.
        </p>
      ) : null}

      <h2>2. What we collect</h2>
      <ul>
        <li>
          <strong>Booking details:</strong> your name, email address, mobile number, chosen cake, pickup
          window, order value and deposit.
        </li>
        <li>
          <strong>Free-text notes:</strong> anything you choose to tell the baker, such as a name for the
          cake or allergy information. Notes are optional.
        </li>
        <li>
          <strong>Payment metadata:</strong> the amount, currency and Stripe PaymentIntent, charge and
          refund identifiers. Card details are entered directly into Stripe Elements and never reach our
          servers.
        </li>
        <li>
          <strong>Technical and security data:</strong> IP address, browser user-agent and request logs used
          to prevent abuse, diagnose errors and keep the service secure. Admin accounts also have session
          records.
        </li>
        <li>
          <strong>Privacy choices:</strong> the version of this notice you accepted, the time you accepted
          it, any explicit consent for health information in notes, and your cookie preference.
        </li>
        <li>
          <strong>Data-subject requests:</strong> an audit record of export or erasure requests. The email
          in that record is stored as a one-way hash, not in clear text.
        </li>
      </ul>
      <p>
        We do not create customer accounts or passwords, we do not store card numbers, and we do not use
        your data for advertising or profiling.
      </p>

      <h2>3. Why we use it, and our legal bases</h2>
      <table>
        <thead>
          <tr>
            <th>Purpose</th>
            <th>Legal basis (GDPR Art. 6)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Reserve a pickup slot, take the deposit, confirm and deliver your booking.</td>
            <td>Performance of a contract — Art. 6(1)(b).</td>
          </tr>
          <tr>
            <td>Send booking confirmation, cancellation, expiry and payment emails.</td>
            <td>Performance of a contract — Art. 6(1)(b).</td>
          </tr>
          <tr>
            <td>Keep invoices, tax records and payment/refund evidence.</td>
            <td>Legal obligation — Art. 6(1)(c).</td>
          </tr>
          <tr>
            <td>Prevent fraud, secure the site, rate-limit abuse and debug failures.</td>
            <td>Legitimate interests — Art. 6(1)(f).</td>
          </tr>
          <tr>
            <td>Store allergy or health information you include in notes.</td>
            <td>Explicit consent — Art. 9(2)(a).</td>
          </tr>
          <tr>
            <td>Remember your cookie choice and, if ever introduced, optional analytics.</td>
            <td>Consent — Art. 6(1)(a), or strictly necessary for the choice itself.</td>
          </tr>
        </tbody>
      </table>
      <p>
        Where we rely on legitimate interests, we have balanced those interests against your rights and
        expect the risk to be low because the data is limited to security and service operation. You may
        object at any time using the contact details below.
      </p>

      <h2>4. Allergy and health information</h2>
      <p>
        Information about allergies or medical conditions is special-category data. We only collect it if
        you type it into the optional notes field, and we ask for your explicit consent at checkout when
        notes are present. Please share only what the baker needs to prepare and hand over your cake
        safely. You can withdraw consent by asking us to erase the notes; we will do so unless a legal
        obligation requires us to keep a record.
      </p>

      <h2>5. Who we share it with</h2>
      <p>
        We share only what is necessary with the following categories of recipients, who act as processors
        or independent controllers under their own terms:
      </p>
      <ul>
        <li>
          <strong>Stripe</strong> — payment processing, receipts and refunds. Stripe receives your email
          address, payment amount and booking reference. See Stripe’s privacy policy for its own handling.
        </li>
        <li>
          <strong>Resend</strong> — transactional email delivery for booking confirmations, cancellations
          and expiry notices.
        </li>
        <li>
          <strong>Hosting and database providers</strong> — the infrastructure that runs the website, API
          and MySQL database. Access is restricted and logged.
        </li>
        <li>
          <strong>Professional advisers and authorities</strong> — where required by law, tax, accounting
          or to establish or defend legal claims.
        </li>
      </ul>
      <p>We do not sell personal data, and we do not share it for advertising.</p>

      <h2>6. International transfers</h2>
      <p>
        Some processors, particularly Stripe and Resend, may process data outside the EEA or UK, including
        in the United States. Where that happens, transfers rely on an adequacy decision (such as the EU–US
        Data Privacy Framework where the recipient is certified) or on Standard Contractual Clauses with
        additional safeguards. You can ask us for more information about the safeguard used.
      </p>

      <h2>7. How long we keep it</h2>
      <ul>
        <li>
          <strong>Booking personal data</strong> (name, email, phone, notes) is kept while the booking is
          active and for up to 730 days after it is closed (or the shorter period configured by the
          bakery), unless you ask us to erase it sooner. It is then anonymised automatically.
        </li>
        <li>
          <strong>Financial records</strong> (order values, payment and refund identifiers, timestamps) are
          kept for as long as tax, accounting and consumer-law obligations require, even after the
          personal data has been removed.
        </li>
        <li>
          <strong>Email delivery queue</strong> is pruned after 30 days. Stripe webhook payloads are
          redacted after 30 days, keeping event identifiers for idempotency.
        </li>
        <li>
          <strong>Security and session logs</strong> are kept only as long as needed to investigate abuse
          and then deleted or aggregated.
        </li>
      </ul>

      <h2>8. Your rights</h2>
      <p>If you are in the EEA or UK, you have the right to:</p>
      <ul>
        <li>be informed about how we use your data (this notice);</li>
        <li>access a copy of your data and receive it in a portable format;</li>
        <li>have inaccurate data corrected;</li>
        <li>ask us to erase your data, subject to legal retention duties;</li>
        <li>restrict or object to processing, including direct marketing (we do not send marketing);</li>
        <li>withdraw consent at any time, without affecting processing already carried out;</li>
        <li>not be subject to a solely automated decision with legal or similarly significant effects —
          we do not make such decisions; and</li>
        <li>complain to a supervisory authority in your country of residence, work or the alleged breach.</li>
      </ul>
      <p>
        You can exercise access and erasure immediately on our{" "}
        <Link href="/privacy/request">data request page</Link>. For anything else, email{" "}
        <a href={`mailto:${privacyEmail}`}>{privacyEmail}</a>. We normally respond within one month; complex
        requests may take up to three months, and we will tell you if that applies.
      </p>

      <h2>9. Cookies and similar technologies</h2>
      <p>
        We use essential cookies for secure admin sign-in and to remember your cookie choice. We do not
        currently use analytics or advertising cookies. Full details and controls are in our{" "}
        <Link href="/cookies">cookie policy</Link>.
      </p>

      <h2>10. Security</h2>
      <p>
        We use encryption in transit, access controls, hashed refresh tokens, rate limiting, webhook
        signature verification and least-privilege database access. Card data is handled by Stripe and
        never stored by us. No system is perfectly secure, but we review controls regularly and will
        notify you and the relevant authority of a personal-data breach where the law requires it.
      </p>

      <h2>11. Children</h2>
      <p>
        The booking service is intended for adults arranging a cake. We do not knowingly collect data from
        children under 16. If you believe a child has provided personal data, contact us and we will remove
        it.
      </p>

      <h2>12. Changes to this notice</h2>
      <p>
        We may update this notice to reflect changes in the law or our service. The version and effective
        date are shown at the top. If a change materially affects how we use data you have already
        provided, we will tell you by email or a prominent notice before it applies.
      </p>

      <h2>13. Contact and complaints</h2>
      <p>
        Questions, requests or concerns: <a href={`mailto:${privacyEmail}`}>{privacyEmail}</a>.
      </p>
      <p>
        If you are not satisfied, you can complain to your local data-protection authority. In the UK that
        is the Information Commissioner’s Office (ICO); in the EU it is the supervisory authority in your
        country of residence. In Australia, contact the Office of the Australian Information Commissioner
        (OAIC). You can also complain to the bakery directly at{" "}
        <a href={`mailto:${store.email ?? privacyEmail}`}>{store.email ?? privacyEmail}</a>.
      </p>
    </LegalShell>
  );
}
