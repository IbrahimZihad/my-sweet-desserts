type Level = "debug" | "info" | "warn" | "error";

/**
 * Minimal structured-ish logger. Replaces NestJS's `Logger` so services keep
 * the `new Logger(Service.name)` / `logger.error(message, error)` call shape.
 */
export class Logger {
  constructor(private readonly context?: string) {}

  debug(message: string): void {
    this.write("debug", message);
  }

  log(message: string): void {
    this.write("info", message);
  }

  warn(message: string): void {
    this.write("warn", message);
  }

  error(message: string, error?: unknown): void {
    this.write("error", message, error);
  }

  private write(level: Level, message: string, error?: unknown): void {
    const line = `[${new Date().toISOString()}] ${level.toUpperCase()}${
      this.context ? ` (${this.context})` : ""
    } ${message}`;

    if (level === "error") {
      if (error === undefined) console.error(line);
      else console.error(line, error);
      return;
    }
    if (level === "warn") {
      console.warn(line);
      return;
    }
    console.log(line);
  }
}
