import { Module } from "@nestjs/common";
import { AdminSlotsController, SlotsController } from "./slots.controller";
import { SlotsService } from "./slots.service";

@Module({
  controllers: [SlotsController, AdminSlotsController],
  providers: [SlotsService],
  exports: [SlotsService],
})
export class SlotsModule {}
