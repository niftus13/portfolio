import { describe, expect, it } from "vitest";

import {
  hashPassword,
  verifyPassword,
} from "../../apps/api/src/identity/password.js";

describe("password hashing", () => {
  it("uses a different salt per hash and verifies only the matching password", async () => {
    const first = await hashPassword("test-password-123");
    const second = await hashPassword("test-password-123");

    expect(first).not.toBe(second);
    await expect(verifyPassword("test-password-123", first)).resolves.toBe(
      true,
    );
    await expect(verifyPassword("incorrect-password", first)).resolves.toBe(
      false,
    );
  });

  it("fails explicitly for a malformed stored hash", async () => {
    await expect(
      verifyPassword("test-password-123", "scrypt$bad"),
    ).rejects.toThrow("invalid format");
  });
});
