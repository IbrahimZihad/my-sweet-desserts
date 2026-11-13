import Link from "next/link";
import { PRIVACY_POLICY_EFFECTIVE_DATE } from "@cakeflow/contracts";
import { CookieSettingsButton } from "@/components/privacy/CookieSettingsButton";
import { LegalShell } from "@/components/privacy/LegalShell";
import { getStorefront } from "@/lib/storefront.server";

export const dynamic = "force-dynamic";

export default async function CookiePolicyPage() {
  const store = await getStorefront();

  return (
    <LegalShell store={store} title="Cookie policy" updated={PRIVACY_POLICY_EFFECTIVE_DATE}>
      <p>
        This policy explains the cookies and similar technologies used by the {store.name} booking site.
        We keep the list deliberately short: there are no advertising, cross-site tracking or analytics
        cookies on this site.
      </p>

      <h2>What is a cookie?</h2>
      <p>
        A cookie is a small text file stored by your browser. Some cookies are <strong>strictly
        necessary</strong> for security and for the site to work. Others, such as analytics or
        advertising cookies, would require your consent. We currently use only the essential category.
      </p>

      <h2>Cookies we set</h2>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Purpose</th>
            <th>Duration</th>
            <th>Category</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>cf_access</code></td>
            <td>Short-lived admin access token. HttpOnly, SameSite=Lax, Secure in production.</td>
            <td>15 minutes</td>
            <td>Strictly necessary</td>
          </tr>
          <tr>
            <td><code>cf_refresh</code></td>
            <td>Rotating admin refresh session. Scoped to <code>/api/auth</code>.</td>
            <td>30 days</td>
            <td>Strictly necessary</td>
          </tr>
          <tr>
            <td><code>cf_bakery</code></td>
            <td>Remembers which bakery the admin session belongs to.</td>
            <td>30 days</td>
            <td>Strictly necessary</td>
          </tr>
          <tr>
            <td><code>cf_consent</code></td>
            <td>Records that you have seen this notice and your cookie choice.</td>
            <td>1 year</td>
            <td>Strictly necessary</td>
          </tr>
        </tbody>
      </table>

      <h2>Cookies set by Stripe</h2>
      <p>
        When you pay a deposit, Stripe Elements loads on the payment step. Stripe may set cookies such as{" "}
        <code>__stripe_mid</code>, <code>__stripe_sid</code> and <code>m</code> to prevent fraud, remember
        the payment session and keep the checkout secure. These are necessary to process your payment and
        are controlled by Stripe. See Stripe’s cookie and privacy documentation for details.
      </p>

      <h2>Browser storage</h2>
      <p>
        The admin dashboard stores one preference in your browser’s local storage:{" "}
        <code>cf_announcements_enabled</code>. It remembers whether you muted the spoken new-booking
        announcements. It is never sent to our servers and is not used for tracking.
      </p>

      <h2>What we do not use</h2>
      <ul>
        <li>No Google Analytics, Meta Pixel or other analytics/tracking scripts.</li>
        <li>No advertising or retargeting cookies.</li>
        <li>No cross-site profiling or sale of data.</li>
      </ul>
      <p>
        If we introduce optional analytics in future, we will ask for your consent first and update this
        page and the cookie banner. The choice will be just as easy to withdraw as to give.
      </p>

      <h2>Managing cookies</h2>
      <p>
        You can change your choice at any time by opening <CookieSettingsButton className="text-ink underline underline-offset-4" />.
        You can also block or delete cookies in your browser settings. Blocking essential cookies may stop
        admin sign-in or payment from working.
      </p>
      <p>
        For more information about cookies and your choices, see{" "}
        <a href="https://www.aboutcookies.org" rel="noreferrer" target="_blank">
          aboutcookies.org
        </a>{" "}
        or your browser’s help pages. For the personal data we process, see our{" "}
        <Link href="/privacy">privacy notice</Link>.
      </p>

      <h2>Changes</h2>
      <p>
        We will update this policy if our use of cookies changes. The effective date is shown at the top.
      </p>
    </LegalShell>
  );
}
