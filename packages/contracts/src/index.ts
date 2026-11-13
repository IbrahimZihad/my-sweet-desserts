import { z } from "zod";

/* ────────────────────────────────────────────────────────────
 * Shared enums — kept structurally identical to Prisma enums.
 * Importing these into the web app avoids string drift.
 * ──────────────────────────────────────────────────────────── */

export const UserRole = {
  OWNER: "OWNER",
  STAFF: "STAFF",
  CUSTOMER: "CUSTOMER",
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

export const OrderStatus = {
  HELD: "HELD",
  PENDING_PAYMENT: "PENDING_PAYMENT",
  CONFIRMED: "CONFIRMED",
  CANCELLED: "CANCELLED",
  EXPIRED: "EXPIRED",
  COMPLETED: "COMPLETED",
} as const;
export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];

export const PaymentStatus = {
  REQUIRES_PAYMENT: "REQUIRES_PAYMENT",
  PROCESSING: "PROCESSING",
  SUCCEEDED: "SUCCEEDED",
  FAILED: "FAILED",
  REFUNDED: "REFUNDED",
  PARTIALLY_REFUNDED: "PARTIALLY_REFUNDED",
  CANCELLED: "CANCELLED",
} as const;
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

export const PaymentKind = {
  DEPOSIT: "DEPOSIT",
  BALANCE: "BALANCE",
  REFUND: "REFUND",
} as const;
export type PaymentKind = (typeof PaymentKind)[keyof typeof PaymentKind];

export const SlotStatus = {
  OPEN: "OPEN",
  CLOSED: "CLOSED",
} as const;
export type SlotStatus = (typeof SlotStatus)[keyof typeof SlotStatus];

export const DepositType = {
  FLAT: "FLAT",
  PERCENTAGE: "PERCENTAGE",
} as const;
export type DepositType = (typeof DepositType)[keyof typeof DepositType];

/* ────────────────────────────────────────────────────────────
 * Privacy / GDPR
 *
 * The legal notice text lives in the web app. This version string is pinned
 * onto every order at the moment consent is captured, so a later policy update
 * never rewrites the consent history.
 * ──────────────────────────────────────────────────────────── */

export const PRIVACY_POLICY_VERSION = "2026-11-13";
export const PRIVACY_POLICY_EFFECTIVE_DATE = "13 November 2026";

export const PrivacyRequestType = {
  EXPORT: "EXPORT",
  ERASURE: "ERASURE",
} as const;
export type PrivacyRequestType = (typeof PrivacyRequestType)[keyof typeof PrivacyRequestType];

/* ────────────────────────────────────────────────────────────
 * Primitives
 * ──────────────────────────────────────────────────────────── */

export const idSchema = z.string().cuid2();
export const isoDateTimeSchema = z.string().datetime({ offset: true });
export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");
export const emailSchema = z.string().email().max(254).transform((v) => v.toLowerCase().trim());
export const phoneSchema = z
  .string()
  .trim()
  .min(8)
  .max(20)
  .regex(/^[+()\d\s-]+$/, "Invalid phone number");
export const moneyCentsSchema = z.number().int().nonnegative().max(10_000_00);

/* ────────────────────────────────────────────────────────────
 * Availability
 * ──────────────────────────────────────────────────────────── */

export const availabilityQuerySchema = z
  .object({
    from: isoDateSchema,
    to: isoDateSchema,
    cakeId: idSchema.optional(),
  })
  .refine((q) => q.from <= q.to, { message: "`from` must be before or equal to `to`", path: ["to"] })
  .refine(
    (q) => (new Date(q.to).getTime() - new Date(q.from).getTime()) / 86_400_000 <= 62,
    { message: "Availability window cannot exceed 62 days", path: ["to"] },
  );

export type AvailabilityQuery = z.infer<typeof availabilityQuerySchema>;

export interface AvailableSlotDto {
  id: string;
  startsAt: string;
  endsAt: string;
  capacity: number;
  booked: number;
  remaining: number;
  priceCents: number | null;
  isAvailable: boolean;
}

export interface AvailabilityResponse {
  bakery: PublicBakeryDto;
  slots: AvailableSlotDto[];
}

/* ────────────────────────────────────────────────────────────
 * Public bakery / catalog
 * ──────────────────────────────────────────────────────────── */

export interface PublicBakeryDto {
  id: string;
  slug: string;
  name: string;
  legalName?: string | null;
  email?: string;
  logoUrl: string | null;
  brandColor: string;
  heroImageUrl: string | null;
  about: string | null;
  currency: string;
  timezone: string;
  depositPolicy: {
    type: DepositType;
    value: number;
    refundable: boolean;
    refundWindowHours: number;
  };
}

export interface CakeDto {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  flavour: string;
  sizeLabel: string;
  servings: number;
  priceCents: number;
  imageUrl: string | null;
  allergens: string[];
}

/* ────────────────────────────────────────────────────────────
 * Booking creation
 * ──────────────────────────────────────────────────────────── */

export const bookingCustomerSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: emailSchema,
  phone: phoneSchema,
});

export const createBookingSchema = z
  .object({
    cakeId: idSchema,
    slotId: idSchema,
    customer: bookingCustomerSchema,
    notes: z.string().trim().max(500).optional(),
    /** Server recomputes the deposit; the client only acknowledges the policy. */
    acceptDepositPolicy: z.literal(true),
    /** GDPR Art. 13: the privacy notice must be acknowledged before collection. */
    acceptPrivacyPolicy: z.literal(true),
    /**
     * GDPR Art. 9(2)(a): explicit consent is required when free-text notes may
     * contain health or allergy information (special-category data).
     */
    healthDataConsent: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.notes && value.notes.length > 0 && value.healthDataConsent !== true) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["healthDataConsent"],
        message: "Explicit consent is required to store notes that may contain health information.",
      });
    }
  });

export type CreateBookingInput = z.infer<typeof createBookingSchema>;

export interface CreateBookingResponse {
  orderId: string;
  reference: string;
  status: OrderStatus;
  depositCents: number;
  totalCents: number;
  currency: string;
  clientSecret: string;
  /** ISO timestamp; slot is released automatically after this. */
  holdExpiresAt: string;
  publishableKey?: string;
}

export interface BookingSummaryDto {
  id: string;
  reference: string;
  status: OrderStatus;
  cakeName: string;
  slotStartsAt: string;
  slotEndsAt: string;
  totalCents: number;
  depositCents: number;
  depositStatus: PaymentStatus;
  depositRefundable: boolean;
  customerName: string;
  customerEmail: string;
  createdAt: string;
}

/* ────────────────────────────────────────────────────────────
 * Data subject requests (GDPR Art. 15, 17, 20)
 * ──────────────────────────────────────────────────────────── */

export const privacyRequestSchema = z.object({
  email: emailSchema,
  reference: z.string().trim().min(6).max(24),
});

export type PrivacyRequestInput = z.infer<typeof privacyRequestSchema>;

export const privacyErasureSchema = privacyRequestSchema.extend({
  /** Irreversible action: the customer must tick an explicit confirmation. */
  confirm: z.literal(true),
  reason: z.string().trim().max(500).optional(),
});

export type PrivacyErasureInput = z.infer<typeof privacyErasureSchema>;

export interface PrivacyOrderExportDto {
  reference: string;
  status: OrderStatus;
  cakeName: string;
  slotStartsAt: string;
  totalCents: number;
  depositCents: number;
  currency: string;
  createdAt: string;
  privacyPolicyVersion: string | null;
  privacyAcceptedAt: string | null;
  healthDataConsentAt: string | null;
}

export interface PrivacyExportResponse {
  exportedAt: string;
  policyVersion: string;
  bakery: { name: string; email: string };
  subject: { name: string; email: string; phone: string | null };
  orders: PrivacyOrderExportDto[];
  payments: Array<{
    orderReference: string;
    kind: PaymentKind;
    status: PaymentStatus;
    amountCents: number;
    refundedCents: number;
    currency: string;
    createdAt: string;
  }>;
  /** Plain-language note about the legal basis and the rights that remain. */
  notice: string;
}

export interface PrivacyErasureResponse {
  erased: true;
  confirmationId: string;
  anonymisedOrders: number;
  requestedAt: string;
  /** What was retained, and why (financial/accounting obligation). */
  retained: string;
}

export interface PrivacyRequestSummaryDto {
  id: string;
  type: PrivacyRequestType;
  status: "COMPLETED" | "REJECTED";
  reference: string;
  subjectEmailHashPrefix: string;
  requestedAt: string;
  completedAt: string | null;
}

/* ────────────────────────────────────────────────────────────
 * Admin: live booking announcements (read aloud in the dashboard)
 * ──────────────────────────────────────────────────────────── */

export interface BookingAnnouncementDto {
  id: string;
  reference: string;
  customerName: string;
  cakeName: string;
  slotStartsAt: string;
  status: OrderStatus;
  createdAt: string;
}

export interface BookingAnnouncementsResponse {
  announcements: BookingAnnouncementDto[];
  /** Server clock, used as the next `since` cursor (minus a small overlap). */
  serverTime: string;
}

/* ────────────────────────────────────────────────────────────
 * Auth
 * ──────────────────────────────────────────────────────────── */

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(10).max(128),
});

export type LoginInput = z.infer<typeof loginSchema>;

export interface AuthUserDto {
  id: string;
  bakeryId: string;
  email: string;
  name: string;
  role: Extract<UserRole, "OWNER" | "STAFF">;
}

export interface LoginResponse {
  user: AuthUserDto;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export const refreshSchema = z.object({ refreshToken: z.string().min(20) });

/* ────────────────────────────────────────────────────────────
 * Admin
 * ──────────────────────────────────────────────────────────── */

export const updateSlotSchema = z
  .object({
    capacity: z.number().int().min(1).max(200).optional(),
    status: z.enum([SlotStatus.OPEN, SlotStatus.CLOSED]).optional(),
    priceOverrideCents: moneyCentsSchema.nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "At least one field is required");

export type UpdateSlotInput = z.infer<typeof updateSlotSchema>;

export const generateSlotsSchema = z.object({
  from: isoDateSchema,
  to: isoDateSchema,
  weekdays: z.array(z.number().int().min(0).max(6)).min(1),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  durationMinutes: z.number().int().min(15).max(480),
  capacity: z.number().int().min(1).max(200),
});

export type GenerateSlotsInput = z.infer<typeof generateSlotsSchema>;

export const updateBakerySchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  about: z.string().trim().max(2000).nullable().optional(),
  brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  logoUrl: z.string().url().nullable().optional(),
  heroImageUrl: z.string().url().nullable().optional(),
  depositType: z.enum([DepositType.FLAT, DepositType.PERCENTAGE]).optional(),
  depositValue: z.number().int().nonnegative().optional(),
  depositRefundable: z.boolean().optional(),
  refundWindowHours: z.number().int().min(0).max(720).optional(),
  holdMinutes: z.number().int().min(5).max(60).optional(),
  leadTimeHours: z.number().int().min(0).max(720).optional(),
});

export type UpdateBakeryInput = z.infer<typeof updateBakerySchema>;

/* ────────────────────────────────────────────────────────────
 * Error envelope — identical shape across API and BFF
 * ──────────────────────────────────────────────────────────── */

export interface ApiErrorBody {
  statusCode: number;
  code: string;
  message: string;
  details?: unknown;
  requestId?: string;
}
