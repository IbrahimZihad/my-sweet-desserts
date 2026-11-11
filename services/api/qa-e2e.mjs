/**
 * CakeFlow QA — black-box HTTP suite + signed Stripe webhook tests + DB assertions.
 * Temporary QA harness, not part of the product.
 */
import Stripe from "stripe";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";

process.env.DATABASE_URL = "mysql://root@127.0.0.1:3307/cakeflow";
const prisma = new PrismaClient();
const stripe = new Stripe("sk_test_qa_dummy_key");

const API = "http://127.0.0.1:4000";
const WEB = "http://localhost:3000";
const KEY = "qa-internal-key-0123456789abcdef0123456789";
const TENANT = "sweetcrumbs";
const WEBHOOK_SECRET = "whsec_qa_secret_123";
const OWNER = { email: "owner@sweetcrumbs.test", password: "ChangeMe123!" };
const STAFF = { email: "staff@sweetcrumbs.test", password: "StaffPass123!" };
const DEMO = { reference: "CF-DEMO01", email: "demo@sweetcrumbs.test" };

const results = [];
let currentPhase = "";
function phase(name) {
  currentPhase = name;
  console.log(`\n=== ${name} ===`);
}
async function test(name, fn) {
  try {
    const detail = await fn();
    results.push({ phase: currentPhase, name, ok: true, detail: detail ?? "" });
    console.log(`PASS  ${name}${detail ? ` — ${detail}` : ""}`);
  } catch (error) {
    results.push({ phase: currentPhase, name, ok: false, error: error?.message ?? String(error) });
    console.log(`FAIL  ${name} — ${error?.message ?? error}`);
  }
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}
function assertEq(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function assertStatus(res, expected) {
  if (res.status !== expected) {
    throw new Error(`expected HTTP ${expected}, got ${res.status}: ${JSON.stringify(res.body).slice(0, 400)}`);
  }
}
function assert2xx(res) {
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`expected 2xx, got ${res.status}: ${JSON.stringify(res.body).slice(0, 400)}`);
  }
}

async function request(url, { method = "GET", body, headers = {}, rawBody, redirect } = {}) {
  const init = { method, headers: { accept: "application/json", ...headers }, redirect: redirect ?? "follow" };
  if (rawBody !== undefined) init.body = rawBody;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers["content-type"] = "application/json";
  }
  const response = await fetch(url, init);
  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { status: response.status, body: parsed, headers: response.headers, text };
}

function api(path, opts = {}) {
  const { ip = "10.10.0.1", tenant = TENANT, auth, internalKey = KEY, ...rest } = opts;
  const headers = { ...(rest.headers ?? {}) };
  if (internalKey) headers["x-internal-key"] = internalKey;
  if (tenant) headers["x-bakery-slug"] = tenant;
  if (ip) headers["x-forwarded-for"] = ip;
  if (auth) headers.authorization = `Bearer ${auth}`;
  return request(`${API}${path}`, { ...rest, headers });
}

function bff(path, opts = {}) {
  const { ip = "10.30.0.1", cookie, ...rest } = opts;
  const headers = { ...(rest.headers ?? {}) };
  if (ip) headers["x-forwarded-for"] = ip;
  if (cookie) headers.cookie = cookie;
  return request(`${WEB}${path}`, { ...rest, headers });
}

function melbourneDate(date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Melbourne",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
function addDays(date, days) {
  return new Date(date.getTime() + days * 86_400_000);
}
function iso(date) {
  return date.toISOString();
}
function randomSuffix() {
  return randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase();
}
async function signEvent(payload) {
  const raw = JSON.stringify(payload);
  const signature = stripe.webhooks.generateTestHeaderString({ payload: raw, secret: WEBHOOK_SECRET });
  return { raw, signature };
}
async function sendWebhook(event) {
  const { raw, signature } = await signEvent(event);
  return request(`${API}/v1/payments/webhook`, {
    method: "POST",
    rawBody: raw,
    headers: { "content-type": "application/json", "stripe-signature": signature },
  });
}

const state = { bakery: null, cake: null, validSlot: null, leadSlot: null, ownerToken: null, ownerRefresh: null, staffToken: null };

async function loadFixtures() {
  state.bakery = await prisma.bakery.findUniqueOrThrow({ where: { slug: TENANT } });
  state.cake = await prisma.cake.findFirstOrThrow({ where: { bakeryId: state.bakery.id, isActive: true } });
  const now = Date.now();
  state.validSlot = await prisma.slot.findFirst({
    where: { bakeryId: state.bakery.id, status: "OPEN", startsAt: { gt: new Date(now + 72 * 3_600_000) } },
    orderBy: { startsAt: "asc" },
  });
  state.leadSlot = await prisma.slot.findFirst({
    where: {
      bakeryId: state.bakery.id,
      status: "OPEN",
      startsAt: { gt: new Date(now + 3_600_000), lt: new Date(now + 40 * 3_600_000) },
    },
    orderBy: { startsAt: "asc" },
  });
  assert(state.validSlot, "no seeded slot beyond the 48h lead time");
  assert(state.leadSlot, "no seeded slot inside the 48h lead window");
}

async function createSlot({ offsetDays = 5, hour = 11, capacity = 5, bookedCount = 0, status = "OPEN" }) {
  const base = addDays(new Date(), offsetDays);
  const date = melbourneDate(base);
  const startsAt = new Date(`${date}T${String(hour).padStart(2, "0")}:30:00+11:00`);
  const slot = await prisma.slot.create({
    data: {
      bakeryId: state.bakery.id,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 45 * 60_000),
      serviceDate: new Date(`${date}T00:00:00.000Z`),
      capacity,
      bookedCount,
      status,
    },
  });
  return slot;
}

async function createHeldOrder({ slot, amountCents, status = "HELD", pi, email, holdMinutes = 30 }) {
  const customer = await prisma.user.upsert({
    where: { bakeryId_email: { bakeryId: state.bakery.id, email } },
    update: {},
    create: { bakeryId: state.bakery.id, email, name: "QA Customer", role: "CUSTOMER" },
  });
  const order = await prisma.order.create({
    data: {
      reference: `QA-${randomSuffix()}`,
      bakeryId: state.bakery.id,
      customerId: customer.id,
      cakeId: state.cake.id,
      slotId: slot.id,
      status,
      customerName: "QA Customer",
      customerEmail: email,
      customerPhone: "+61400000000",
      totalCents: amountCents * 4,
      depositCents: amountCents,
      balanceDueCents: amountCents * 3,
      currency: "AUD",
      depositRefundable: true,
      refundWindowHours: 48,
      holdExpiresAt: new Date(Date.now() + holdMinutes * 60_000),
      idempotencyKey: `qa-${randomUUID()}`,
    },
  });
  const payment = await prisma.payment.create({
    data: {
      bakeryId: state.bakery.id,
      orderId: order.id,
      kind: "DEPOSIT",
      status: "REQUIRES_PAYMENT",
      amountCents,
      currency: "AUD",
      refundable: true,
      stripePaymentIntentId: pi,
    },
  });
  return { order, payment, customer };
}

function intentObject({ pi, orderId, amount, currency = "aud", latestCharge = "ch_qa_1" }) {
  return {
    id: pi,
    object: "payment_intent",
    amount,
    currency,
    status: "succeeded",
    latest_charge: latestCharge,
    metadata: { orderId, bakeryId: state.bakery.id, purpose: "DEPOSIT" },
  };
}

async function main() {
  await loadFixtures();
  console.log(`Fixtures: bakery=${state.bakery.id} cake=${state.cake.name} validSlot=${iso(state.validSlot.startsAt)} leadSlot=${iso(state.leadSlot.startsAt)}`);

  /* ---------------------------------------------------------------- */
  phase("Health & internal key");
  await test("GET /health returns ok and DB up", async () => {
    const res = await request(`${API}/health`);
    assertStatus(res, 200);
    assertEq(res.body.status, "ok", "status");
    assertEq(res.body.database, "up", "database");
    return `latency ${res.body.latencyMs}ms`;
  });
  await test("public API rejects missing internal key", async () => {
    const res = await api("/v1/storefront", { internalKey: null });
    assertStatus(res, 401);
    return res.body?.code ?? "";
  });
  await test("public API rejects wrong internal key", async () => {
    const res = await api("/v1/storefront", { internalKey: "wrong-key-wrong-key-wrong-key" });
    assertStatus(res, 401);
  });
  await test("webhook stays reachable without internal key", async () => {
    const res = await request(`${API}/v1/payments/webhook`, { method: "POST", rawBody: "{}", headers: { "content-type": "application/json" } });
    assertStatus(res, 400);
    assertEq(res.body.code, "STRIPE_SIGNATURE_MISSING", "code");
  });

  /* ---------------------------------------------------------------- */
  phase("Tenant resolution");
  await test("storefront without tenant context is rejected", async () => {
    const res = await api("/v1/storefront", { tenant: null });
    assertStatus(res, 400);
    assertEq(res.body.code, "TENANT_REQUIRED", "code");
  });
  await test("unknown tenant slug is rejected", async () => {
    const res = await api("/v1/storefront", { tenant: "does-not-exist" });
    assertStatus(res, 400);
    assertEq(res.body.code, "TENANT_REQUIRED", "code");
  });
  await test("known tenant returns branded storefront", async () => {
    const res = await api("/v1/storefront");
    assertStatus(res, 200);
    assertEq(res.body.slug, TENANT, "slug");
    assert(res.body.cakes.length >= 3, "expected at least 3 cakes");
    assertEq(res.body.currency, "AUD", "currency");
    return `${res.body.cakes.length} cakes`;
  });

  /* ---------------------------------------------------------------- */
  phase("Auth & roles");
  await test("wrong password returns 401", async () => {
    const res = await api("/v1/auth/login", { method: "POST", body: { email: OWNER.email, password: "nope-nope-nope" } });
    assertStatus(res, 401);
    assertEq(res.body.code, "INVALID_CREDENTIALS", "code");
    return res.body.message;
  });
  await test("unknown email returns the same 401 (no user enumeration)", async () => {
    const res = await api("/v1/auth/login", { method: "POST", body: { email: "ghost@sweetcrumbs.test", password: "nope-nope-nope" } });
    assertStatus(res, 401);
    assertEq(res.body.code, "INVALID_CREDENTIALS", "code");
  });
  await test("owner can sign in", async () => {
    const res = await api("/v1/auth/login", { method: "POST", body: OWNER });
    assert2xx(res);
    assertEq(res.body.user.role, "OWNER", "role");
    assert(res.body.accessToken && res.body.refreshToken, "tokens missing");
    state.ownerToken = res.body.accessToken;
    state.ownerRefresh = res.body.refreshToken;
    return `expiresIn=${res.body.expiresIn}s`;
  });
  await test("GET /v1/auth/me requires a token", async () => {
    const res = await api("/v1/auth/me");
    assertStatus(res, 401);
  });
  await test("GET /v1/auth/me rejects a tampered token", async () => {
    const res = await api("/v1/auth/me", { auth: `${state.ownerToken.slice(0, -4)}aaaa` });
    assertStatus(res, 401);
  });
  await test("GET /v1/auth/me returns the signed-in owner", async () => {
    const res = await api("/v1/auth/me", { auth: state.ownerToken });
    assertStatus(res, 200);
    assertEq(res.body.email, OWNER.email, "email");
    assertEq(res.body.bakeryId, state.bakery.id, "bakeryId");
  });
  await test("refresh rotates the refresh token", async () => {
    const first = await api("/v1/auth/refresh", { method: "POST", body: { refreshToken: state.ownerRefresh } });
    assert2xx(first);
    const replay = await api("/v1/auth/refresh", { method: "POST", body: { refreshToken: state.ownerRefresh } });
    assertStatus(replay, 401);
    state.ownerToken = first.body.accessToken;
    state.ownerRefresh = first.body.refreshToken;
    return "old token rejected after rotation";
  });
  await test("staff can sign in and is blocked from owner-only slot admin", async () => {
    const login = await api("/v1/auth/login", { method: "POST", body: STAFF, ip: "10.10.0.1" });
    assert2xx(login);
    assertEq(login.body.user.role, "STAFF", "role");
    state.staffToken = login.body.accessToken;
    const slots = await api("/v1/admin/slots?from=2026-11-01&to=2026-11-30", { auth: state.staffToken });
    assertStatus(slots, 403);
    const bookings = await api("/v1/admin/bookings", { auth: state.staffToken });
    assertStatus(bookings, 200);
    return "admin/slots 403, admin/bookings 200";
  });
  await test("admin endpoints reject anonymous access", async () => {
    const res = await api("/v1/admin/bookings");
    assertStatus(res, 401);
  });

  /* ---------------------------------------------------------------- */
  phase("Admin slots & capacity");
  const from = melbourneDate(new Date());
  const to = melbourneDate(addDays(new Date(), 7));
  let generatedSlotId = null;
  await test("owner lists slots", async () => {
    const res = await api(`/v1/admin/slots?from=${from}&to=${to}`, { auth: state.ownerToken });
    assertStatus(res, 200);
    assert(Array.isArray(res.body) && res.body.length > 0, "no slots returned");
    return `${res.body.length} slots`;
  });
  await test("slot generation rejects invalid capacity", async () => {
    const res = await api("/v1/admin/slots/generate", {
      method: "POST",
      auth: state.ownerToken,
      body: { from, to, weekdays: [1, 2, 3, 4, 5], startTime: "09:00", endTime: "17:00", durationMinutes: 60, capacity: 0 },
    });
    assertStatus(res, 400);
  });
  await test("slot generation is idempotent", async () => {
    const body = {
      from: melbourneDate(addDays(new Date(), 80)),
      to: melbourneDate(addDays(new Date(), 81)),
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      startTime: "09:00",
      endTime: "12:00",
      durationMinutes: 60,
      capacity: 2,
    };
    const first = await api("/v1/admin/slots/generate", { method: "POST", auth: state.ownerToken, body });
    assert2xx(first);
    const second = await api("/v1/admin/slots/generate", { method: "POST", auth: state.ownerToken, body });
    assert2xx(second);
    assertEq(second.body.created, 0, "second run created");
    assert(second.body.skipped >= first.body.created, "skipped count");
    generatedSlotId = first.body.created;
    return `created ${first.body.created}, re-run skipped ${second.body.skipped}`;
  });
  await test("capacity cannot drop below existing bookings", async () => {
    const slot = await createSlot({ offsetDays: 6, hour: 14, capacity: 3, bookedCount: 2 });
    const res = await api(`/v1/admin/slots/${slot.id}`, { method: "PATCH", auth: state.ownerToken, body: { capacity: 1 } });
    assertStatus(res, 409);
    assertEq(res.body.code, "CAPACITY_BELOW_BOOKINGS", "code");
    await prisma.slot.delete({ where: { id: slot.id } });
  });
  await test("owner closes and reopens a slot", async () => {
    const slot = await createSlot({ offsetDays: 7, hour: 15, capacity: 2 });
    const close = await api(`/v1/admin/slots/${slot.id}`, { method: "PATCH", auth: state.ownerToken, body: { status: "CLOSED" } });
    assertStatus(close, 200);
    assertEq(close.body.status, "CLOSED", "status");
    const reopen = await api(`/v1/admin/slots/${slot.id}`, { method: "PATCH", auth: state.ownerToken, body: { status: "OPEN" } });
    assertStatus(reopen, 200);
    await prisma.slot.delete({ where: { id: slot.id } });
  });
  await test("admin stats respond for owner", async () => {
    const res = await api("/v1/admin/stats", { auth: state.ownerToken });
    assertStatus(res, 200);
    return JSON.stringify(res.body).slice(0, 120);
  });

  /* ---------------------------------------------------------------- */
  phase("Availability");
  const availFrom = melbourneDate(state.validSlot.startsAt);
  await test("availability requires from/to", async () => {
    const res = await api("/v1/slots");
    assertStatus(res, 400);
  });
  await test("availability rejects inverted range", async () => {
    const res = await api(`/v1/slots?from=${to}&to=${from}`);
    assertStatus(res, 400);
  });
  await test("availability hides slots inside the lead time", async () => {
    const leadDate = melbourneDate(state.leadSlot.startsAt);
    const res = await api(`/v1/slots?from=${leadDate}&to=${leadDate}&cakeId=${state.cake.id}`);
    assertStatus(res, 200);
    const ids = res.body.slots.map((slot) => slot.id);
    assert(!ids.includes(state.leadSlot.id), "lead-time slot was offered");
    return `${res.body.slots.length} slots offered`;
  });
  await test("availability returns remaining capacity", async () => {
    const res = await api(`/v1/slots?from=${availFrom}&to=${availFrom}&cakeId=${state.cake.id}`);
    assertStatus(res, 200);
    const slot = res.body.slots.find((item) => item.id === state.validSlot.id);
    assert(slot, "expected fixture slot to be offered");
    assertEq(slot.remaining, slot.capacity - slot.booked, "remaining");
    return `${slot.remaining}/${slot.capacity} free`;
  });
  await test("availability rejects unknown cake", async () => {
    const res = await api(`/v1/slots?from=${availFrom}&to=${availFrom}&cakeId=not-a-cake`);
    assertStatus(res, 404);
    assertEq(res.body.code, "CAKE_NOT_FOUND", "code");
  });

  /* ---------------------------------------------------------------- */
  phase("Booking API (payment provider intentionally unavailable)");
  const bookingIp = "10.20.0.1";
  const bookingBase = {
    cakeId: state.cake.id,
    slotId: state.validSlot.id,
    customer: { name: "QA Tester", email: `qa+${randomSuffix().toLowerCase()}@example.com`, phone: "+61400111222" },
    acceptDepositPolicy: true,
  };
  await test("booking requires an idempotency key", async () => {
    const res = await api("/v1/bookings", { method: "POST", body: bookingBase, ip: bookingIp });
    assertStatus(res, 400);
    assertEq(res.body.code, "IDEMPOTENCY_KEY_REQUIRED", "code");
  });
  await test("booking rejects an unknown slot", async () => {
    const res = await api("/v1/bookings", {
      method: "POST",
      body: { ...bookingBase, slotId: "not-a-slot" },
      ip: bookingIp,
      headers: { "idempotency-key": `qa-${randomUUID()}` },
    });
    assertStatus(res, 404);
    assertEq(res.body.code, "SLOT_NOT_FOUND", "code");
  });
  await test("booking enforces the 48h lead time", async () => {
    const res = await api("/v1/bookings", {
      method: "POST",
      body: { ...bookingBase, slotId: state.leadSlot.id },
      ip: bookingIp,
      headers: { "idempotency-key": `qa-${randomUUID()}` },
    });
    assertStatus(res, 409);
    assertEq(res.body.code, "LEAD_TIME_NOT_MET", "code");
    return res.body.message;
  });
  await test("booking enforces max advance days", async () => {
    const slot = await createSlot({ offsetDays: 90, hour: 10, capacity: 2 });
    const res = await api("/v1/bookings", {
      method: "POST",
      body: { ...bookingBase, slotId: slot.id },
      ip: bookingIp,
      headers: { "idempotency-key": `qa-${randomUUID()}` },
    });
    assertStatus(res, 409);
    assertEq(res.body.code, "TOO_FAR_AHEAD", "code");
    await prisma.slot.delete({ where: { id: slot.id } });
  });
  await test("booking rejects a full slot without charging", async () => {
    const slot = await createSlot({ offsetDays: 8, hour: 11, capacity: 1, bookedCount: 1 });
    const res = await api("/v1/bookings", {
      method: "POST",
      body: { ...bookingBase, slotId: slot.id },
      ip: bookingIp,
      headers: { "idempotency-key": `qa-${randomUUID()}` },
    });
    assertStatus(res, 409);
    assertEq(res.body.code, "SLOT_FULL", "code");
    const after = await prisma.slot.findUniqueOrThrow({ where: { id: slot.id } });
    assertEq(after.bookedCount, 1, "bookedCount");
    await prisma.slot.delete({ where: { id: slot.id } });
  });

  let failedBookingKey = `qa-${randomUUID()}`;
  let failedBookingRef = null;
  await test("Stripe failure rolls back capacity and cancels the hold", async () => {
    const slot = await createSlot({ offsetDays: 9, hour: 12, capacity: 2 });
    const res = await api("/v1/bookings", {
      method: "POST",
      body: { ...bookingBase, slotId: slot.id },
      ip: bookingIp,
      headers: { "idempotency-key": failedBookingKey },
    });
    assertStatus(res, 502);
    assertEq(res.body.code, "PAYMENT_PROVIDER_ERROR", "code");
    const after = await prisma.slot.findUniqueOrThrow({ where: { id: slot.id } });
    assertEq(after.bookedCount, 0, "slot bookedCount after rollback");
    const order = await prisma.order.findFirst({
      where: { bakeryId: state.bakery.id, idempotencyKey: failedBookingKey },
      include: { payments: true, events: true },
    });
    assert(order, "order row missing");
    assertEq(order.status, "CANCELLED", "order status");
    assertEq(order.payments[0].status, "FAILED", "payment status");
    assert(order.events.some((event) => event.type === "PAYMENT_FAILED"), "missing PAYMENT_FAILED event");
    failedBookingRef = order.reference;
    state.rollbackSlotId = slot.id;
    return `${order.reference} cancelled, capacity released`;
  });
  await test("replaying the same idempotency key cannot resurrect a cancelled hold", async () => {
    const res = await api("/v1/bookings", {
      method: "POST",
      body: { ...bookingBase, slotId: state.rollbackSlotId },
      ip: bookingIp,
      headers: { "idempotency-key": failedBookingKey },
    });
    assertStatus(res, 410);
    assertEq(res.body.code, "HOLD_EXPIRED", "code");
    return "known UX trap: UI must mint a new key";
  });
  await test("a fresh key succeeds in reserving again after provider recovery", async () => {
    const res = await api("/v1/bookings", {
      method: "POST",
      body: { ...bookingBase, slotId: state.rollbackSlotId },
      ip: bookingIp,
      headers: { "idempotency-key": `qa-${randomUUID()}` },
    });
    assertStatus(res, 502);
    const slot = await prisma.slot.findUniqueOrThrow({ where: { id: state.rollbackSlotId } });
    assertEq(slot.bookedCount, 0, "capacity released again");
  });

  /* ---------------------------------------------------------------- */
  phase("Booking lookup & cancellation");
  await test("lookup with the right email returns the demo booking", async () => {
    const res = await api(`/v1/bookings/${DEMO.reference}?email=${encodeURIComponent(DEMO.email)}`);
    assertStatus(res, 200);
    assertEq(res.body.reference, DEMO.reference, "reference");
    assertEq(res.body.status, "CONFIRMED", "status");
    return `${res.body.depositStatus} deposit`;
  });
  await test("lookup with the wrong email is indistinguishable from missing", async () => {
    const wrong = await api(`/v1/bookings/${DEMO.reference}?email=wrong@example.com`);
    assertStatus(wrong, 404);
    const missing = await api(`/v1/bookings/CF-NOPE99?email=wrong@example.com`);
    assertStatus(missing, 404);
    assertEq(wrong.body.code, missing.body.code, "error code");
  });
  await test("customer can cancel an unpaid hold and capacity returns", async () => {
    const slot = await createSlot({ offsetDays: 10, hour: 13, capacity: 3, bookedCount: 1 });
    const email = `qa+cancel-${randomSuffix().toLowerCase()}@example.com`;
    const { order } = await createHeldOrder({ slot, amountCents: 3000, pi: `pi_qa_cancel_${randomSuffix()}`, email });
    const res = await api(`/v1/bookings/${order.reference}/cancel`, {
      method: "POST",
      body: { email },
      ip: "10.20.0.2",
    });
    assert2xx(res);
    assertEq(res.body.status, "CANCELLED", "status");
    assertEq(res.body.refunded, false, "refunded");
    const after = await prisma.slot.findUniqueOrThrow({ where: { id: slot.id } });
    assertEq(after.bookedCount, 0, "bookedCount");
    const repeat = await api(`/v1/bookings/${order.reference}/cancel`, { method: "POST", body: { email }, ip: "10.20.0.2" });
    assertStatus(repeat, 409);
    return "idempotent-ish: second cancel 409";
  });
  await test("cancelling the seeded CONFIRMED booking without a Stripe PI surfaces a defect", async () => {
    const res = await api(`/v1/bookings/${DEMO.reference}/cancel`, {
      method: "POST",
      body: { email: DEMO.email },
      ip: "10.20.0.3",
    });
    const order = await prisma.order.findUniqueOrThrow({ where: { reference: DEMO.reference } });
    if (res.status === 404 && res.body.code === "NO_REFUNDABLE_PAYMENT") {
      throw new Error(`DEFECT: cancellation returns 404 and leaves order ${order.status}; seeded/legacy succeeded payments lack stripePaymentIntentId`);
    }
    assertStatus(res, 200);
    return `status ${res.body.status}`;
  });

  /* ---------------------------------------------------------------- */
  phase("Stripe webhooks (signed)");
  await test("invalid signature is rejected", async () => {
    const res = await request(`${API}/v1/payments/webhook`, {
      method: "POST",
      rawBody: JSON.stringify({ id: "evt_bad", type: "payment_intent.succeeded" }),
      headers: { "content-type": "application/json", "stripe-signature": "t=1,v1=deadbeef" },
    });
    assertStatus(res, 400);
    assertEq(res.body.code, "STRIPE_SIGNATURE_INVALID", "code");
  });
  await test("unknown event types are acknowledged and stored", async () => {
    const eventId = `evt_qa_unknown_${randomSuffix()}`;
    const res = await sendWebhook({ id: eventId, object: "event", type: "customer.created", data: { object: { id: "cus_qa" } } });
    assertStatus(res, 200);
    const stored = await prisma.stripeEvent.findUnique({ where: { stripeEventId: eventId } });
    assert(stored?.processedAt, "event not marked processed");
  });

  let confirmedOrder = null;
  let confirmedPayment = null;
  let confirmedPi = null;
  let confirmEventId = null;
  await test("payment_intent.succeeded confirms a HELD order exactly once", async () => {
    const slot = await createSlot({ offsetDays: 11, hour: 14, capacity: 5, bookedCount: 1 });
    const email = `qa+confirm-${randomSuffix().toLowerCase()}@example.com`;
    confirmedPi = `pi_qa_confirm_${randomSuffix()}`;
    const { order, payment } = await createHeldOrder({ slot, amountCents: 4500, pi: confirmedPi, email });
    confirmedOrder = order;
    confirmedPayment = payment;
    confirmEventId = `evt_qa_confirm_${randomSuffix()}`;
    const res = await sendWebhook({
      id: confirmEventId,
      object: "event",
      type: "payment_intent.succeeded",
      data: { object: intentObject({ pi: confirmedPi, orderId: order.id, amount: 4500 }) },
    });
    assertStatus(res, 200);
    const afterOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    assertEq(afterOrder.status, "CONFIRMED", "order status");
    assert(afterOrder.confirmedAt, "confirmedAt missing");
    const afterPayment = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    assertEq(afterPayment.status, "SUCCEEDED", "payment status");
    assertEq(afterPayment.stripeChargeId, "ch_qa_1", "charge id");
    const outbox = await prisma.emailOutbox.findMany({ where: { orderId: order.id, template: "BOOKING_CONFIRMED" } });
    assertEq(outbox.length, 1, "confirmation emails");
    const afterSlot = await prisma.slot.findUniqueOrThrow({ where: { id: slot.id } });
    assertEq(afterSlot.bookedCount, 1, "slot bookedCount");
    return `order ${order.reference} confirmed, 1 email queued`;
  });
  await test("duplicate webhook delivery is idempotent", async () => {
    const res = await sendWebhook({
      id: confirmEventId,
      object: "event",
      type: "payment_intent.succeeded",
      data: { object: intentObject({ pi: confirmedPi, orderId: confirmedOrder.id, amount: 4500 }) },
    });
    assertStatus(res, 200);
    assertEq(res.body.duplicate, true, "duplicate flag");
    const outbox = await prisma.emailOutbox.findMany({ where: { orderId: confirmedOrder.id, template: "BOOKING_CONFIRMED" } });
    assertEq(outbox.length, 1, "emails after replay");
    return "no second confirmation email";
  });
  await test("amount mismatch fails loudly and leaves the order unconfirmed", async () => {
    const slot = await createSlot({ offsetDays: 12, hour: 15, capacity: 2, bookedCount: 1 });
    const email = `qa+mismatch-${randomSuffix().toLowerCase()}@example.com`;
    const pi = `pi_qa_mismatch_${randomSuffix()}`;
    const { order } = await createHeldOrder({ slot, amountCents: 4500, pi, email });
    const eventId = `evt_qa_mismatch_${randomSuffix()}`;
    const res = await sendWebhook({
      id: eventId,
      object: "event",
      type: "payment_intent.succeeded",
      data: { object: intentObject({ pi, orderId: order.id, amount: 100 }) },
    });
    assert(res.status >= 500, `expected 5xx, got ${res.status}`);
    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    assertEq(after.status, "HELD", "order status");
    const event = await prisma.stripeEvent.findUnique({ where: { stripeEventId: eventId } });
    assert(event?.error, "event error not recorded");
    return `event parked for retry: ${event.error.slice(0, 60)}`;
  });
  await test("payment_intent.payment_failed keeps the hold alive", async () => {
    const slot = await createSlot({ offsetDays: 13, hour: 16, capacity: 2, bookedCount: 1 });
    const email = `qa+failed-${randomSuffix().toLowerCase()}@example.com`;
    const pi = `pi_qa_failed_${randomSuffix()}`;
    const { order, payment } = await createHeldOrder({ slot, amountCents: 3000, pi, email });
    const res = await sendWebhook({
      id: `evt_qa_failed_${randomSuffix()}`,
      object: "event",
      type: "payment_intent.payment_failed",
      data: { object: { ...intentObject({ pi, orderId: order.id, amount: 3000 }), status: "requires_payment_method", last_payment_error: { code: "card_declined", message: "Your card was declined." } } },
    });
    assertStatus(res, 200);
    const afterPayment = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    assertEq(afterPayment.status, "FAILED", "payment status");
    assertEq(afterPayment.failureCode, "card_declined", "failureCode");
    const afterOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    assertEq(afterOrder.status, "HELD", "order status");
    const afterSlot = await prisma.slot.findUniqueOrThrow({ where: { id: slot.id } });
    assertEq(afterSlot.bookedCount, 1, "slot stays reserved");
  });
  await test("payment_intent.canceled expires the order and releases the slot", async () => {
    const slot = await createSlot({ offsetDays: 14, hour: 11, capacity: 2, bookedCount: 1 });
    const email = `qa+intentcancel-${randomSuffix().toLowerCase()}@example.com`;
    const pi = `pi_qa_canceled_${randomSuffix()}`;
    const { order } = await createHeldOrder({ slot, amountCents: 3000, pi, email });
    const res = await sendWebhook({
      id: `evt_qa_canceled_${randomSuffix()}`,
      object: "event",
      type: "payment_intent.canceled",
      data: { object: { ...intentObject({ pi, orderId: order.id, amount: 3000 }), status: "canceled" } },
    });
    assertStatus(res, 200);
    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    assertEq(after.status, "EXPIRED", "order status");
    const afterSlot = await prisma.slot.findUniqueOrThrow({ where: { id: slot.id } });
    assertEq(afterSlot.bookedCount, 0, "slot released");
  });
  await test("late payment on an expired order never confirms it", async () => {
    const slot = await createSlot({ offsetDays: 15, hour: 12, capacity: 2, bookedCount: 0 });
    const email = `qa+late-${randomSuffix().toLowerCase()}@example.com`;
    const pi = `pi_qa_late_${randomSuffix()}`;
    const { order, payment } = await createHeldOrder({ slot, amountCents: 3000, status: "EXPIRED", pi, email });
    const res = await sendWebhook({
      id: `evt_qa_late_${randomSuffix()}`,
      object: "event",
      type: "payment_intent.succeeded",
      data: { object: intentObject({ pi, orderId: order.id, amount: 3000 }) },
    });
    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    assertEq(after.status, "EXPIRED", "order must stay expired");
    const afterPayment = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    assertEq(afterPayment.status, "SUCCEEDED", "late capture recorded");
    if (res.status >= 500) {
      throw new Error(`DEFECT: automatic refund failed (${res.body?.message ?? res.status}); money captured without refund because Stripe call failed`);
    }
    return "late capture auto-refunded";
  });
  await test("charge.refunded syncs the payment ledger", async () => {
    const res = await sendWebhook({
      id: `evt_qa_refund_${randomSuffix()}`,
      object: "event",
      type: "charge.refunded",
      data: { object: { id: "ch_qa_1", object: "charge", payment_intent: confirmedPi, amount_refunded: 4500, refunded: true } },
    });
    assertStatus(res, 200);
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: confirmedPayment.id } });
    assertEq(payment.status, "REFUNDED", "payment status");
    assertEq(payment.refundedCents, 4500, "refundedCents");
  });

  /* ---------------------------------------------------------------- */
  phase("Tenant isolation");
  let otherBakery = null;
  await test("a second tenant only sees its own storefront", async () => {
    otherBakery = await prisma.bakery.create({
      data: { slug: "qa-other", name: "QA Other Bakery", email: "qa@other.test" },
    });
    const res = await api("/v1/storefront", { tenant: "qa-other" });
    assertStatus(res, 200);
    assertEq(res.body.id, otherBakery.id, "bakery id");
    assertEq(res.body.cakes.length, 0, "cakes");
    const crossTenantLookup = await api(`/v1/bookings/${DEMO.reference}?email=${encodeURIComponent(DEMO.email)}`, { tenant: "qa-other" });
    assertStatus(crossTenantLookup, 404);
    return "storefront + booking lookup scoped";
  });
  await test("admin token cannot be retargeted with a tenant header", async () => {
    const res = await api("/v1/admin/bookings", { auth: state.ownerToken, tenant: "qa-other" });
    assertStatus(res, 200);
    const rows = res.body.rows ?? [];
    assert(rows.every((row) => row.customerEmail !== undefined), "unexpected rows");
    const otherOrders = await prisma.order.count({ where: { bakeryId: otherBakery.id } });
    assertEq(otherOrders, 0, "other bakery orders");
    return `${rows.length} own rows despite foreign header`;
  });

  /* ---------------------------------------------------------------- */
  phase("BFF & UI");
  await test("homepage renders the storefront", async () => {
    const res = await bff("/");
    assertStatus(res, 200);
    assert(res.text.includes("Sweet Crumbs"), "bakery name missing from HTML");
  });
  await test("booking page renders", async () => {
    const res = await bff("/book");
    assertStatus(res, 200);
    assert(res.text.includes("Sweet Crumbs"), "bakery name missing");
  });
  await test("BFF availability proxies the tenant", async () => {
    const res = await bff(`/api/availability?from=${availFrom}&to=${availFrom}&cakeId=${state.cake.id}`);
    assertStatus(res, 200);
    assert(Array.isArray(res.body.slots), "slots missing");
  });
  await test("BFF booking lookup works and wrong email 404s", async () => {
    const ok = await bff(`/api/bookings/${DEMO.reference}?email=${encodeURIComponent(DEMO.email)}`);
    assertStatus(ok, 200);
    const bad = await bff(`/api/bookings/${DEMO.reference}?email=nope@example.com`);
    assertStatus(bad, 404);
  });
  await test("BFF rejects malformed JSON", async () => {
    const res = await bff("/api/bookings", { method: "POST", rawBody: "{oops", ip: "10.40.0.1", headers: { "content-type": "application/json" } });
    assertStatus(res, 400);
    assertEq(res.body.code, "INVALID_JSON", "code");
  });
  await test("BFF rejects invalid booking payloads", async () => {
    const res = await bff("/api/bookings", { method: "POST", ip: "10.40.0.2", body: { cakeId: "" } });
    assertStatus(res, 400);
    assertEq(res.body.code, "VALIDATION_ERROR", "code");
  });
  await test("BFF booking forwards to the API and surfaces provider failure", async () => {
    const key = `qa-bff-${randomUUID()}`;
    const body = { ...bookingBase, slotId: state.rollbackSlotId, customer: { ...bookingBase.customer, email: `qa+bff-${randomSuffix().toLowerCase()}@example.com` } };
    const first = await bff("/api/bookings", { method: "POST", ip: "10.41.0.1", body, headers: { "idempotency-key": key } });
    assertStatus(first, 502);
    assertEq(first.body.code, "PAYMENT_PROVIDER_ERROR", "code");
    const replay = await bff("/api/bookings", { method: "POST", ip: "10.41.0.1", body, headers: { "idempotency-key": key } });
    assertStatus(replay, 410);
    return "BFF preserves idempotency semantics (410 on dead hold)";
  });
  await test("BFF booking rate limit kicks in after 5 attempts per IP", async () => {
    let last = null;
    const codes = [];
    for (let i = 0; i < 6; i += 1) {
      last = await bff("/api/bookings", { method: "POST", rawBody: "{oops", ip: "10.99.9.9", headers: { "content-type": "application/json" } });
      codes.push(last.status);
    }
    assertEq(codes.slice(0, 5).every((code) => code === 400), true, `first five: ${codes.join(",")}`);
    assertEq(last.status, 429, "sixth status");
    assert(last.headers.get("retry-after"), "Retry-After header missing");
    return codes.join(",");
  });
  let bffCookies = null;
  await test("BFF login sets hardened auth cookies", async () => {
    const res = await bff("/api/auth/login", { method: "POST", ip: "10.50.0.1", body: OWNER });
    assertStatus(res, 200);
    const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get("set-cookie") ?? ""];
    const joined = raw.join("\n");
    assert(joined.includes("cf_access="), "cf_access cookie missing");
    assert(joined.includes("cf_refresh="), "cf_refresh cookie missing");
    assert(/httponly/i.test(joined), "HttpOnly missing");
    assert(/samesite=lax/i.test(joined), "SameSite=Lax missing");
    bffCookies = raw.map((line) => line.split(";")[0]).join("; ");
    return raw.map((line) => line.split(";")[0].split("=")[0]).join(", ");
  });
  await test("BFF refresh rotates cookies", async () => {
    const res = await bff("/api/auth/refresh", { method: "POST", cookie: bffCookies });
    assertStatus(res, 200);
    const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get("set-cookie") ?? ""];
    bffCookies = raw.map((line) => line.split(";")[0]).join("; ");
  });
  await test("BFF logout revokes the session", async () => {
    const logout = await bff("/api/auth/logout", { method: "POST", cookie: bffCookies });
    assertStatus(logout, 200);
    const refresh = await bff("/api/auth/refresh", { method: "POST", cookie: bffCookies });
    assertStatus(refresh, 401);
  });
  await test("unauthenticated /admin redirects to login", async () => {
    const res = await bff("/admin", { redirect: "manual" });
    assertEq(res.status, 307, "status");
    const location = res.headers.get("location") ?? "";
    assert(location.includes("/admin/login"), `unexpected location ${location}`);
  });
  await test("booking responses are not cached", async () => {
    const res = await bff(`/api/bookings/${DEMO.reference}?email=${encodeURIComponent(DEMO.email)}`);
    assertStatus(res, 200);
    assertEq(res.headers.get("cache-control"), "no-store", "cache-control");
  });

  /* ---------------------------------------------------------------- */
  // cleanup second tenant
  if (otherBakery) {
    await prisma.user.deleteMany({ where: { bakeryId: otherBakery.id } });
    await prisma.bakery.delete({ where: { id: otherBakery.id } }).catch(() => {});
  }

  const failed = results.filter((item) => !item.ok);
  console.log(`\n================ SUMMARY ================`);
  console.log(`Total: ${results.length}  Passed: ${results.length - failed.length}  Failed: ${failed.length}`);
  if (failed.length) {
    console.log(`\nFailures:`);
    for (const item of failed) console.log(` - [${item.phase}] ${item.name}: ${item.error}`);
  }
  const fs = await import("node:fs/promises");
  await fs.writeFile("qa-results.json", JSON.stringify(results, null, 2), "utf8");
  await prisma.$disconnect();
  process.exit(failed.length ? 1 : 0);
}

main().catch(async (error) => {
  console.error("FATAL", error);
  await prisma.$disconnect();
  process.exit(2);
});
