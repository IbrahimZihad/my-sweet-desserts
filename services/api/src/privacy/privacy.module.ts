import { Module } from "@nestjs/common";
import { AdminPrivacyController, PrivacyController } from "./privacy.controller";
import { PrivacyService } from "./privacy.service";

@Module({
  controllers: [PrivacyController, AdminPrivacyController],
  providers: [PrivacyService],
  exports: [PrivacyService],
})
export class PrivacyModule {}
