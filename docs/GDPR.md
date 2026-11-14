# GDPR compliance — CakeFlow

This document maps the European data-protection requirements (GDPR, and by
extension the UK GDPR) to the controls implemented in this repository. It is an
engineering reference, not legal advice: have the final notice, DPAs and
retention periods reviewed by a qualified adviser for each market you serve.

## 1. Roles

| Party | Role | Notes |
| --- | --- | --- |
| The bakery tenant | Data controller | Decides why and how booking data is used. Its legal name/email appears on the public notice. |
| CakeFlow platform operator | Processor | Hosts the software, database and email pipeline. Must sign a DPA with each bakery. |
| Stripe | Processor / independent controller | Payment processing, fraud prevention and receipts. |
| Resend | Processor | Transactional email delivery. |
| Hosting + MySQL provider | Processor | Application and database infrastructure. |

The public notice at `/privacy` names the controller dynamically from the
tenant record (`Bakery.legalName || Bakery.name`) and uses
`PRIVACY_CONTACT_EMAIL` (falling back to `Bakery.email`).

## 2. Lawful basis and consent

| Processing | Legal basis | Implementation |
| --- | --- | --- |
| Reserve slot, take deposit, fulfil order | Art. 6(1)(b) contract | `Order`, `Payment` rows |
| Confirmation/cancellation/expiry emails | Art. 6(1)(b) contract | `EmailOutbox` templates |
| Tax, accounting, refund evidence | Art. 6(1)(c) legal obligation | Payment ledger retained after PII erasure |
| Fraud, rate limiting, security logs | Art. 6(1)(f) legitimate interests | `SESSION`, throttler, webhook signatures |
| Allergy/health notes | Art. 9(2)(a) explicit consent | Required `healthDataConsent` when notes are present |
| Cookie preference | Art. 6(1)(a) consent / strictly necessary | `cf_consent` cookie |

At checkout the API pins `PRIVACY_POLICY_VERSION`, `privacyAcceptedAt` and
(when notes exist) `healthDataConsentAt` onto the order. A later policy update
never rewrites the consent history. The shared schema rejects a booking if the
privacy notice is not accepted, or if notes are supplied without explicit
health-data consent.

## 3. Transparency

- `/privacy` — full Art. 13/14 notice: controller, categories, purposes, legal
  bases, recipients, transfers, retention, rights, complaints.
- `/cookies` — cookie table, browser storage, and a control to reopen the
  notice.
- `/privacy/request` — self-service access/portability and erasure.
- The booking wizard links both notices and shows a separate health-data
  consent when notes are entered.
- The cookie notice is rendered from the root layout and records the choice in a
  first-party `cf_consent` cookie (1 year, `SameSite=Lax`). There are no
  analytics or advertising cookies today.

## 4. Data-subject rights

| Right | Implementation |
| --- | --- |
| Access (Art. 15) | `POST /v1/privacy/export` (BFF: `POST /api/privacy/export`) returns JSON for every order matching the verified email. |
| Portability (Art. 20) | The same JSON is machine-readable and downloads as a file. |
| Erasure (Art. 17) | `POST /v1/privacy/erase` anonymises name/email/phone/notes, deletes the email queue, deactivates the customer and revokes sessions. |
| Rectification (Art. 16) | Contact channel in the notice; staff can correct order/customer data. |
| Restriction / objection (Art. 18, 21) | Contact channel; no marketing or solely automated decisions exist. |
| Withdraw consent (Art. 7(3)) | Health-data consent can be withdrawn by erasing the notes; cookie choice can be reopened at any time. |

Verification uses the existing `reference + email` pair. A wrong pair returns
the same `404` as a missing booking, so the form cannot be used to enumerate
references. The BFF and API both rate-limit requests to 5 per minute per IP.

Erasure is refused with `409 ACTIVE_BOOKINGS` while a future booking is still
active, because destroying the delivery data would prevent fulfilment. The
customer can cancel first or return after pickup.

What erasure keeps: booking reference, amounts, currency, payment/refund
identifiers and timestamps. These are needed for tax, accounting, chargeback
and legal-claim purposes. No name, email, phone, notes or cancellation reason
remain.

`PrivacyRequest` is the accountability record. It stores the email as a SHA-256
hash, never in clear text, plus the request type, reference and timestamps.
Owners can review the log at `/admin/privacy`.

## 5. Storage limitation

`Bakery.piiRetentionDays` defaults to 730 days. A nightly job
(`privacy-retention`, 03:00) anonymises closed orders (`CANCELLED`, `EXPIRED`,
`COMPLETED`) older than the window, and:

- redacts Stripe webhook payloads after `STRIPE_EVENT_RETENTION_DAYS` (30 by
  default) while keeping event IDs for idempotency;
- deletes sent/failed email-outbox rows after 30 days;
- deletes expired sessions.

The job is idempotent. It can be re-run for one tenant through
`POST /v1/admin/privacy/retention/run` (OWNER only).

## 6. Security measures (Art. 32)

- TLS in transit; MySQL should use TLS and encryption at rest.
- Card data never reaches CakeFlow; Stripe Elements posts directly to Stripe.
- Admin passwords use scrypt; refresh tokens are hashed and rotated; access
  tokens are short-lived and session-checked on every request.
- Tenant isolation is enforced on every query and covered by `docs/SECURITY.md`.
- Stripe webhooks are signature-verified and idempotent.
- Rate limits apply globally, on login and on booking/privacy endpoints.
- Application logs use order/event IDs, not customer payloads.
- Helmet, restrictive headers, `SameSite=Lax` cookies and Secure cookies in
  production.

Known gaps to close before a large EU launch:

- Field-level encryption for `Order.notes` and phone numbers (they can contain
  special-category data).
- A signed DPA with every bakery and sub-processor.
- An EU representative under Art. 27 if the controller has no EU establishment.
- A DPIA if the bakery scales to large-scale or systematic monitoring.
- Documented breach-response runbook with a 72-hour notification clock.
- Independent penetration test and restore test of encrypted backups.

## 7. International transfers

Stripe and Resend may process data in the United States. The notice states that
transfers rely on an adequacy decision (including the EU–US Data Privacy
Framework where certified) or Standard Contractual Clauses plus supplementary
measures. Keep the signed SCC/DPF evidence with the vendor DPA.

## 8. Operational checklist

- [ ] Set `PRIVACY_CONTACT_EMAIL` (and `PRIVACY_DPO_EMAIL` if appointed).
- [ ] Publish `/privacy`, `/cookies` and `/privacy/request` on every tenant
      domain.
- [ ] Review the retention period with the bakery's accountant; update
      `Bakery.piiRetentionDays` if a shorter/longer period is lawful.
- [ ] Sign DPAs with the bakery, Stripe, Resend and the hosting provider.
- [ ] Confirm Stripe/Resend transfer safeguards and record them.
- [ ] Test an export and an erasure on a staging booking.
- [ ] Configure log retention and confirm no PII enters the log drain.
- [ ] Document the breach process, owners and 72-hour notification path.
- [ ] Re-review this notice whenever a new processor, cookie or data field is
      added.

## 9. Request handling procedure

1. Customer submits `/privacy/request` (or emails the contact address).
2. The self-service export verifies `reference + email` and downloads JSON.
3. Erasure verifies the same pair, rejects active future bookings, then
   anonymises in one transaction and writes a `PrivacyRequest` audit row.
4. For requests that cannot be self-served, verify identity proportionately,
   log the decision, and respond within one month (extendable by two months
   with notice).
5. Never email an export containing PII unless the customer has proved control
   of the address; prefer the authenticated download flow.
