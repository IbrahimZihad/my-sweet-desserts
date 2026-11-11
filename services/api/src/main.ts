import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { AppModule } from "./app.module";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { rawBody: true, bufferLogs: true });
  const config = app.get(ConfigService);
  const logger = new Logger("Bootstrap");

  app.set("trust proxy", 1);
  app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
  app.use(cookieParser());

  const origins = config
    .getOrThrow<string>("WEB_ORIGIN")
    .split(",")
    .map((origin) => origin.trim());

  app.enableCors({
    origin: origins,
    credentials: true,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Idempotency-Key", "x-bakery-slug", "x-request-id"],
    exposedHeaders: ["x-request-id"],
    maxAge: 600,
  });

  // Stripe webhooks must remain outside the versioned prefix.
  app.setGlobalPrefix("v1", { exclude: ["health"] });
  app.enableShutdownHooks();

  const port = config.get<number>("PORT") ?? 4000;
  await app.listen(port, "0.0.0.0");
  logger.log(`CakeFlow API listening on :${port}`);
}

void bootstrap();
