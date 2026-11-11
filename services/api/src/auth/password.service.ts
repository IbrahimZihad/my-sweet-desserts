import { Injectable } from "@nestjs/common";
import { promisify } from "node:util";
import {
  randomBytes,
  scrypt as scryptCallback,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
) => Promise<Buffer>;

const KEY_LENGTH = 64;

@Injectable()
export class PasswordService {
  /** Computed once so a missing user and a wrong password take similar time. */
  private readonly dummyHash = this.hashSync("cakeflow-dummy-password");

  async hash(password: string): Promise<string> {
    const salt = randomBytes(16).toString("hex");
    const derived = await scrypt(password, salt, KEY_LENGTH);
    return `scrypt$${salt}$${derived.toString("hex")}`;
  }

  async verify(password: string, stored: string | null): Promise<boolean> {
    if (!stored) {
      await scrypt(password, this.dummyHash.split("$")[1]!, KEY_LENGTH);
      return false;
    }
    const [, salt, expectedHex] = stored.split("$");
    if (!salt || !expectedHex) return false;

    const expected = Buffer.from(expectedHex, "hex");
    const actual = await scrypt(password, salt, expected.length);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  private hashSync(password: string): string {
    // Only used for the dummy value; real hashes are async.
    const salt = randomBytes(16).toString("hex");
    const derived = scryptSync(password, salt, KEY_LENGTH);
    return `scrypt$${salt}$${derived.toString("hex")}`;
  }
}
