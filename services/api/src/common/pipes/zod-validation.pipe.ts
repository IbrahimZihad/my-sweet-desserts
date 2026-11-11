import { BadRequestException, Injectable, PipeTransform } from "@nestjs/common";
import { ZodError, ZodSchema } from "zod";

/**
 * Typed Zod validation for controller inputs.
 * Throws the same error envelope shape used by the Next.js BFF.
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown): T {
    try {
      return this.schema.parse(value);
    } catch (error) {
      if (error instanceof ZodError) {
        throw new BadRequestException({
          code: "VALIDATION_ERROR",
          message: "Request validation failed.",
          details: error.flatten(),
        });
      }
      throw error;
    }
  }
}
