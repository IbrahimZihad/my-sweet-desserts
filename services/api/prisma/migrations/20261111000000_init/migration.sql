-- CreateTable
CREATE TABLE `Bakery` (
    `id` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(63) NOT NULL,
    `customDomain` VARCHAR(253) NULL,
    `name` VARCHAR(120) NOT NULL,
    `legalName` VARCHAR(160) NULL,
    `email` VARCHAR(254) NOT NULL,
    `phone` VARCHAR(32) NULL,
    `timezone` VARCHAR(64) NOT NULL DEFAULT 'Australia/Melbourne',
    `currency` CHAR(3) NOT NULL DEFAULT 'AUD',
    `logoUrl` VARCHAR(2048) NULL,
    `heroImageUrl` VARCHAR(2048) NULL,
    `brandColor` CHAR(7) NOT NULL DEFAULT '#C084A0',
    `about` TEXT NULL,
    `addressLine` VARCHAR(200) NULL,
    `suburb` VARCHAR(100) NULL,
    `postcode` VARCHAR(10) NULL,
    `stripeAccountId` VARCHAR(255) NULL,
    `stripeChargesEnabled` BOOLEAN NOT NULL DEFAULT false,
    `depositType` ENUM('FLAT', 'PERCENTAGE') NOT NULL DEFAULT 'FLAT',
    `depositValue` INTEGER NOT NULL DEFAULT 2000,
    `depositRefundable` BOOLEAN NOT NULL DEFAULT true,
    `refundWindowHours` INTEGER NOT NULL DEFAULT 48,
    `holdMinutes` INTEGER NOT NULL DEFAULT 15,
    `leadTimeHours` INTEGER NOT NULL DEFAULT 48,
    `maxAdvanceDays` INTEGER NOT NULL DEFAULT 90,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Bakery_slug_key`(`slug`),
    UNIQUE INDEX `Bakery_customDomain_key`(`customDomain`),
    UNIQUE INDEX `Bakery_stripeAccountId_key`(`stripeAccountId`),
    INDEX `Bakery_isActive_idx`(`isActive`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `User` (
    `id` VARCHAR(191) NOT NULL,
    `bakeryId` VARCHAR(191) NOT NULL,
    `email` VARCHAR(254) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `phone` VARCHAR(32) NULL,
    `passwordHash` VARCHAR(255) NULL,
    `role` ENUM('OWNER', 'STAFF', 'CUSTOMER') NOT NULL DEFAULT 'CUSTOMER',
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `emailVerifiedAt` DATETIME(3) NULL,
    `lastLoginAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `User_bakeryId_role_isActive_idx`(`bakeryId`, `role`, `isActive`),
    UNIQUE INDEX `User_bakeryId_email_key`(`bakeryId`, `email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Session` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `refreshTokenHash` VARCHAR(64) NOT NULL,
    `userAgent` VARCHAR(512) NULL,
    `ipAddress` VARCHAR(64) NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `revokedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastUsedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Session_refreshTokenHash_key`(`refreshTokenHash`),
    INDEX `Session_userId_expiresAt_idx`(`userId`, `expiresAt`),
    INDEX `Session_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Cake` (
    `id` VARCHAR(191) NOT NULL,
    `bakeryId` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(120) NOT NULL,
    `name` VARCHAR(160) NOT NULL,
    `description` TEXT NULL,
    `flavour` VARCHAR(120) NOT NULL,
    `sizeLabel` VARCHAR(40) NOT NULL,
    `servings` INTEGER NOT NULL DEFAULT 1,
    `priceCents` INTEGER NOT NULL,
    `imageUrl` VARCHAR(2048) NULL,
    `allergens` JSON NULL,
    `leadTimeHours` INTEGER NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Cake_bakeryId_isActive_sortOrder_idx`(`bakeryId`, `isActive`, `sortOrder`),
    UNIQUE INDEX `Cake_bakeryId_slug_key`(`bakeryId`, `slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Slot` (
    `id` VARCHAR(191) NOT NULL,
    `bakeryId` VARCHAR(191) NOT NULL,
    `startsAt` DATETIME(3) NOT NULL,
    `endsAt` DATETIME(3) NOT NULL,
    `serviceDate` DATE NOT NULL,
    `capacity` INTEGER NOT NULL DEFAULT 1,
    `bookedCount` INTEGER NOT NULL DEFAULT 0,
    `status` ENUM('OPEN', 'CLOSED') NOT NULL DEFAULT 'OPEN',
    `priceOverrideCents` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Slot_bakeryId_serviceDate_status_idx`(`bakeryId`, `serviceDate`, `status`),
    UNIQUE INDEX `Slot_bakeryId_startsAt_key`(`bakeryId`, `startsAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Order` (
    `id` VARCHAR(191) NOT NULL,
    `reference` VARCHAR(24) NOT NULL,
    `bakeryId` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `cakeId` VARCHAR(191) NOT NULL,
    `slotId` VARCHAR(191) NOT NULL,
    `createdById` VARCHAR(191) NULL,
    `status` ENUM('HELD', 'PENDING_PAYMENT', 'CONFIRMED', 'CANCELLED', 'EXPIRED', 'COMPLETED') NOT NULL DEFAULT 'HELD',
    `fulfillmentType` ENUM('PICKUP') NOT NULL DEFAULT 'PICKUP',
    `customerName` VARCHAR(120) NOT NULL,
    `customerEmail` VARCHAR(254) NOT NULL,
    `customerPhone` VARCHAR(32) NOT NULL,
    `notes` VARCHAR(500) NULL,
    `totalCents` INTEGER NOT NULL,
    `depositCents` INTEGER NOT NULL,
    `balanceDueCents` INTEGER NOT NULL,
    `currency` CHAR(3) NOT NULL,
    `depositRefundable` BOOLEAN NOT NULL,
    `depositRefundedAt` DATETIME(3) NULL,
    `refundWindowHours` INTEGER NOT NULL,
    `holdExpiresAt` DATETIME(3) NOT NULL,
    `confirmedAt` DATETIME(3) NULL,
    `cancelledAt` DATETIME(3) NULL,
    `cancellationReason` VARCHAR(500) NULL,
    `idempotencyKey` VARCHAR(128) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Order_reference_key`(`reference`),
    INDEX `Order_bakeryId_status_createdAt_idx`(`bakeryId`, `status`, `createdAt`),
    INDEX `Order_bakeryId_slotId_status_idx`(`bakeryId`, `slotId`, `status`),
    INDEX `Order_bakeryId_customerEmail_idx`(`bakeryId`, `customerEmail`),
    INDEX `Order_holdExpiresAt_status_idx`(`holdExpiresAt`, `status`),
    UNIQUE INDEX `Order_bakeryId_idempotencyKey_key`(`bakeryId`, `idempotencyKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Payment` (
    `id` VARCHAR(191) NOT NULL,
    `bakeryId` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `kind` ENUM('DEPOSIT', 'BALANCE', 'REFUND') NOT NULL,
    `status` ENUM('REQUIRES_PAYMENT', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED', 'CANCELLED') NOT NULL DEFAULT 'REQUIRES_PAYMENT',
    `amountCents` INTEGER NOT NULL,
    `currency` CHAR(3) NOT NULL,
    `stripePaymentIntentId` VARCHAR(255) NULL,
    `stripeChargeId` VARCHAR(255) NULL,
    `stripeRefundId` VARCHAR(255) NULL,
    `stripeEventId` VARCHAR(255) NULL,
    `refundable` BOOLEAN NOT NULL DEFAULT true,
    `refundedCents` INTEGER NOT NULL DEFAULT 0,
    `failureCode` VARCHAR(120) NULL,
    `failureMessage` VARCHAR(500) NULL,
    `refundedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Payment_stripePaymentIntentId_key`(`stripePaymentIntentId`),
    INDEX `Payment_bakeryId_status_idx`(`bakeryId`, `status`),
    INDEX `Payment_orderId_idx`(`orderId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StripeEvent` (
    `id` VARCHAR(191) NOT NULL,
    `stripeEventId` VARCHAR(255) NOT NULL,
    `type` VARCHAR(120) NOT NULL,
    `payload` JSON NOT NULL,
    `processingAt` DATETIME(3) NULL,
    `processedAt` DATETIME(3) NULL,
    `error` TEXT NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `StripeEvent_stripeEventId_key`(`stripeEventId`),
    INDEX `StripeEvent_processedAt_createdAt_idx`(`processedAt`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OrderEvent` (
    `id` VARCHAR(191) NOT NULL,
    `bakeryId` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `type` ENUM('CREATED', 'PAYMENT_SUCCEEDED', 'PAYMENT_FAILED', 'CONFIRMED', 'CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_BAKER', 'EXPIRED', 'COMPLETED', 'DEPOSIT_REFUNDED') NOT NULL,
    `actorType` ENUM('CUSTOMER', 'BAKER', 'SYSTEM', 'STRIPE') NOT NULL DEFAULT 'SYSTEM',
    `actorId` VARCHAR(64) NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `OrderEvent_orderId_createdAt_idx`(`orderId`, `createdAt`),
    INDEX `OrderEvent_bakeryId_type_createdAt_idx`(`bakeryId`, `type`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `EmailOutbox` (
    `id` VARCHAR(191) NOT NULL,
    `bakeryId` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NULL,
    `toEmail` VARCHAR(254) NOT NULL,
    `template` VARCHAR(64) NOT NULL,
    `payload` JSON NOT NULL,
    `status` ENUM('PENDING', 'SENT', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `nextAttemptAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `sentAt` DATETIME(3) NULL,
    `lastError` VARCHAR(1000) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `EmailOutbox_status_nextAttemptAt_idx`(`status`, `nextAttemptAt`),
    INDEX `EmailOutbox_bakeryId_createdAt_idx`(`bakeryId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `User` ADD CONSTRAINT `User_bakeryId_fkey` FOREIGN KEY (`bakeryId`) REFERENCES `Bakery`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Session` ADD CONSTRAINT `Session_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Cake` ADD CONSTRAINT `Cake_bakeryId_fkey` FOREIGN KEY (`bakeryId`) REFERENCES `Bakery`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Slot` ADD CONSTRAINT `Slot_bakeryId_fkey` FOREIGN KEY (`bakeryId`) REFERENCES `Bakery`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Order` ADD CONSTRAINT `Order_bakeryId_fkey` FOREIGN KEY (`bakeryId`) REFERENCES `Bakery`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Order` ADD CONSTRAINT `Order_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Order` ADD CONSTRAINT `Order_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Order` ADD CONSTRAINT `Order_cakeId_fkey` FOREIGN KEY (`cakeId`) REFERENCES `Cake`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Order` ADD CONSTRAINT `Order_slotId_fkey` FOREIGN KEY (`slotId`) REFERENCES `Slot`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Payment` ADD CONSTRAINT `Payment_bakeryId_fkey` FOREIGN KEY (`bakeryId`) REFERENCES `Bakery`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Payment` ADD CONSTRAINT `Payment_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OrderEvent` ADD CONSTRAINT `OrderEvent_bakeryId_fkey` FOREIGN KEY (`bakeryId`) REFERENCES `Bakery`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OrderEvent` ADD CONSTRAINT `OrderEvent_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EmailOutbox` ADD CONSTRAINT `EmailOutbox_bakeryId_fkey` FOREIGN KEY (`bakeryId`) REFERENCES `Bakery`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EmailOutbox` ADD CONSTRAINT `EmailOutbox_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

