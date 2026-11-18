-- CreateTable
CREATE TABLE "Bakery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "customDomain" TEXT,
    "name" TEXT NOT NULL,
    "legalName" TEXT,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Australia/Melbourne',
    "currency" TEXT NOT NULL DEFAULT 'AUD',
    "logoUrl" TEXT,
    "heroImageUrl" TEXT,
    "brandColor" TEXT NOT NULL DEFAULT '#C084A0',
    "about" TEXT,
    "addressLine" TEXT,
    "suburb" TEXT,
    "postcode" TEXT,
    "stripeAccountId" TEXT,
    "stripeChargesEnabled" BOOLEAN NOT NULL DEFAULT false,
    "depositType" TEXT NOT NULL DEFAULT 'FLAT',
    "depositValue" INTEGER NOT NULL DEFAULT 2000,
    "depositRefundable" BOOLEAN NOT NULL DEFAULT true,
    "refundWindowHours" INTEGER NOT NULL DEFAULT 48,
    "holdMinutes" INTEGER NOT NULL DEFAULT 15,
    "leadTimeHours" INTEGER NOT NULL DEFAULT 48,
    "maxAdvanceDays" INTEGER NOT NULL DEFAULT 90,
    "piiRetentionDays" INTEGER NOT NULL DEFAULT 730,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bakeryId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "passwordHash" TEXT,
    "role" TEXT NOT NULL DEFAULT 'CUSTOMER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "emailVerifiedAt" DATETIME,
    "lastLoginAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "User_bakeryId_fkey" FOREIGN KEY ("bakeryId") REFERENCES "Bakery" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "expiresAt" DATETIME NOT NULL,
    "revokedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Cake" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bakeryId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "flavour" TEXT NOT NULL,
    "sizeLabel" TEXT NOT NULL,
    "servings" INTEGER NOT NULL DEFAULT 1,
    "priceCents" INTEGER NOT NULL,
    "imageUrl" TEXT,
    "allergens" TEXT,
    "leadTimeHours" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Cake_bakeryId_fkey" FOREIGN KEY ("bakeryId") REFERENCES "Bakery" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Slot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bakeryId" TEXT NOT NULL,
    "startsAt" DATETIME NOT NULL,
    "endsAt" DATETIME NOT NULL,
    "serviceDate" DATETIME NOT NULL,
    "capacity" INTEGER NOT NULL DEFAULT 1,
    "bookedCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "priceOverrideCents" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Slot_bakeryId_fkey" FOREIGN KEY ("bakeryId") REFERENCES "Bakery" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reference" TEXT NOT NULL,
    "bakeryId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "cakeId" TEXT NOT NULL,
    "slotId" TEXT NOT NULL,
    "createdById" TEXT,
    "status" TEXT NOT NULL DEFAULT 'HELD',
    "fulfillmentType" TEXT NOT NULL DEFAULT 'PICKUP',
    "customerName" TEXT NOT NULL,
    "customerEmail" TEXT NOT NULL,
    "customerPhone" TEXT NOT NULL,
    "notes" TEXT,
    "totalCents" INTEGER NOT NULL,
    "depositCents" INTEGER NOT NULL,
    "balanceDueCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "depositRefundable" BOOLEAN NOT NULL,
    "depositRefundedAt" DATETIME,
    "refundWindowHours" INTEGER NOT NULL,
    "holdExpiresAt" DATETIME NOT NULL,
    "confirmedAt" DATETIME,
    "cancelledAt" DATETIME,
    "cancellationReason" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "privacyPolicyVersion" TEXT,
    "privacyAcceptedAt" DATETIME,
    "healthDataConsentAt" DATETIME,
    "anonymisedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Order_bakeryId_fkey" FOREIGN KEY ("bakeryId") REFERENCES "Bakery" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Order_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Order_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Order_cakeId_fkey" FOREIGN KEY ("cakeId") REFERENCES "Cake" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Order_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "Slot" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bakeryId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REQUIRES_PAYMENT',
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "stripePaymentIntentId" TEXT,
    "stripeChargeId" TEXT,
    "stripeRefundId" TEXT,
    "stripeEventId" TEXT,
    "refundable" BOOLEAN NOT NULL DEFAULT true,
    "refundedCents" INTEGER NOT NULL DEFAULT 0,
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "refundedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Payment_bakeryId_fkey" FOREIGN KEY ("bakeryId") REFERENCES "Bakery" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Payment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StripeEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "stripeEventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "processingAt" DATETIME,
    "processedAt" DATETIME,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "OrderEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bakeryId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "actorType" TEXT NOT NULL DEFAULT 'SYSTEM',
    "actorId" TEXT,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrderEvent_bakeryId_fkey" FOREIGN KEY ("bakeryId") REFERENCES "Bakery" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OrderEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EmailOutbox" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bakeryId" TEXT NOT NULL,
    "orderId" TEXT,
    "toEmail" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" DATETIME,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EmailOutbox_bakeryId_fkey" FOREIGN KEY ("bakeryId") REFERENCES "Bakery" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EmailOutbox_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PrivacyRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bakeryId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "reference" TEXT NOT NULL,
    "orderId" TEXT,
    "subjectEmailHash" TEXT NOT NULL,
    "reason" TEXT,
    "requestedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    CONSTRAINT "PrivacyRequest_bakeryId_fkey" FOREIGN KEY ("bakeryId") REFERENCES "Bakery" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PrivacyRequest_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Bakery_slug_key" ON "Bakery"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Bakery_customDomain_key" ON "Bakery"("customDomain");

-- CreateIndex
CREATE UNIQUE INDEX "Bakery_stripeAccountId_key" ON "Bakery"("stripeAccountId");

-- CreateIndex
CREATE INDEX "Bakery_isActive_idx" ON "Bakery"("isActive");

-- CreateIndex
CREATE INDEX "User_bakeryId_role_isActive_idx" ON "User"("bakeryId", "role", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "User_bakeryId_email_key" ON "User"("bakeryId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_refreshTokenHash_key" ON "Session"("refreshTokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_expiresAt_idx" ON "Session"("userId", "expiresAt");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "Cake_bakeryId_isActive_sortOrder_idx" ON "Cake"("bakeryId", "isActive", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "Cake_bakeryId_slug_key" ON "Cake"("bakeryId", "slug");

-- CreateIndex
CREATE INDEX "Slot_bakeryId_serviceDate_status_idx" ON "Slot"("bakeryId", "serviceDate", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Slot_bakeryId_startsAt_key" ON "Slot"("bakeryId", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "Order_reference_key" ON "Order"("reference");

-- CreateIndex
CREATE INDEX "Order_bakeryId_status_createdAt_idx" ON "Order"("bakeryId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Order_bakeryId_slotId_status_idx" ON "Order"("bakeryId", "slotId", "status");

-- CreateIndex
CREATE INDEX "Order_bakeryId_customerEmail_idx" ON "Order"("bakeryId", "customerEmail");

-- CreateIndex
CREATE INDEX "Order_holdExpiresAt_status_idx" ON "Order"("holdExpiresAt", "status");

-- CreateIndex
CREATE INDEX "Order_anonymisedAt_createdAt_idx" ON "Order"("anonymisedAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Order_bakeryId_idempotencyKey_key" ON "Order"("bakeryId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_stripePaymentIntentId_key" ON "Payment"("stripePaymentIntentId");

-- CreateIndex
CREATE INDEX "Payment_bakeryId_status_idx" ON "Payment"("bakeryId", "status");

-- CreateIndex
CREATE INDEX "Payment_orderId_idx" ON "Payment"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "StripeEvent_stripeEventId_key" ON "StripeEvent"("stripeEventId");

-- CreateIndex
CREATE INDEX "StripeEvent_processedAt_createdAt_idx" ON "StripeEvent"("processedAt", "createdAt");

-- CreateIndex
CREATE INDEX "OrderEvent_orderId_createdAt_idx" ON "OrderEvent"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "OrderEvent_bakeryId_type_createdAt_idx" ON "OrderEvent"("bakeryId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "EmailOutbox_status_nextAttemptAt_idx" ON "EmailOutbox"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "EmailOutbox_bakeryId_createdAt_idx" ON "EmailOutbox"("bakeryId", "createdAt");

-- CreateIndex
CREATE INDEX "PrivacyRequest_bakeryId_requestedAt_idx" ON "PrivacyRequest"("bakeryId", "requestedAt");

-- CreateIndex
CREATE INDEX "PrivacyRequest_bakeryId_type_requestedAt_idx" ON "PrivacyRequest"("bakeryId", "type", "requestedAt");
