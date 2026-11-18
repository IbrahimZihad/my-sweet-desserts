import { PrismaClient } from "@prisma/client";

/**
 * Plain Prisma wrapper. The SQLite connector is compiled into Node, so there is
 * no pool or network connection to manage — `connect()` just opens the file.
 */
export class PrismaService extends PrismaClient {
  constructor() {
    super({
      log:
        process.env.NODE_ENV === "development"
          ? [{ emit: "event", level: "warn" }, { emit: "event", level: "error" }]
          : [{ emit: "event", level: "error" }],
    });
  }

  async connect(): Promise<void> {
    await this.$connect();
  }

  async disconnect(): Promise<void> {
    await this.$disconnect();
  }
}
