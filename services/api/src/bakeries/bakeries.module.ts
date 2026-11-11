import { Module } from "@nestjs/common";
import {
  AdminBakeryController,
  AdminStatsController,
  StorefrontController,
} from "./bakeries.controller";

@Module({
  controllers: [StorefrontController, AdminBakeryController, AdminStatsController],
})
export class BakeriesModule {}
