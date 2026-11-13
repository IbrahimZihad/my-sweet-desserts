-- GDPR: consent capture, storage limitation and data-subject request audit.

-- AlterTable
ALTER TABLE `Bakery` ADD COLUMN `piiRetentionDays` INTEGER NOT NULL DEFAULT 730;

-- AlterTable (consent + anonymisation lifecycle)
ALTER TABLE `Order`
  ADD COLUMN `privacyPolicyVersion` VARCHAR(20) NULL,
  ADD COLUMN `privacyAcceptedAt` DATETIME(3) NULL,
  ADD COLUMN `healthDataConsentAt` DATETIME(3) NULL,
  ADD COLUMN `anonymisedAt` DATETIME(3) NULL;

-- CreateIndex
CREATE INDEX `Order_anonymisedAt_createdAt_idx` ON `Order`(`anonymisedAt`, `createdAt`);

-- AlterEnum
ALTER TABLE `OrderEvent` MODIFY COLUMN `type` ENUM(
  'CREATED',
  'PAYMENT_SUCCEEDED',
  'PAYMENT_FAILED',
  'CONFIRMED',
  'CANCELLED_BY_CUSTOMER',
  'CANCELLED_BY_BAKER',
  'EXPIRED',
  'COMPLETED',
  'DEPOSIT_REFUNDED',
  'DATA_EXPORTED',
  'DATA_ERASED'
) NOT NULL;

-- CreateTable
CREATE TABLE `PrivacyRequest` (
    `id` VARCHAR(191) NOT NULL,
    `bakeryId` VARCHAR(191) NOT NULL,
    `type` ENUM('EXPORT', 'ERASURE') NOT NULL,
    `status` ENUM('COMPLETED', 'REJECTED') NOT NULL DEFAULT 'COMPLETED',
    `reference` VARCHAR(24) NOT NULL,
    `orderId` VARCHAR(191) NULL,
    `subjectEmailHash` VARCHAR(64) NOT NULL,
    `reason` VARCHAR(500) NULL,
    `requestedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `completedAt` DATETIME(3) NULL,

    INDEX `PrivacyRequest_bakeryId_requestedAt_idx`(`bakeryId`, `requestedAt`),
    INDEX `PrivacyRequest_bakeryId_type_requestedAt_idx`(`bakeryId`, `type`, `requestedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `PrivacyRequest` ADD CONSTRAINT `PrivacyRequest_bakeryId_fkey` FOREIGN KEY (`bakeryId`) REFERENCES `Bakery`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PrivacyRequest` ADD CONSTRAINT `PrivacyRequest_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
