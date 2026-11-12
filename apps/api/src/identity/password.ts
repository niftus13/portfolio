import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const saltBytes = 16;
const hashBytes = 64;

function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, hashBytes, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(saltBytes);
  const hash = await deriveKey(password, salt);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export async function verifyPassword(
  password: string,
  encoded: string,
): Promise<boolean> {
  const [algorithm, saltHex, hashHex, ...extra] = encoded.split("$");
  if (
    algorithm !== "scrypt" ||
    !saltHex ||
    !hashHex ||
    extra.length !== 0 ||
    !/^[0-9a-f]{32}$/.test(saltHex) ||
    !/^[0-9a-f]{128}$/.test(hashHex)
  ) {
    throw new Error("Stored password hash has an invalid format");
  }
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  const actual = await deriveKey(password, salt);
  return timingSafeEqual(actual, expected);
}
