import { describe, expect, it } from "vitest";

import { normalizeCategoryName } from "../../apps/api/src/categories/normalize-name.js";
import { normalizeEmail } from "../../apps/api/src/identity/normalize-email.js";

describe("email normalization", () => {
  it("removes surrounding whitespace and normalizes case", () => {
    expect(normalizeEmail("  User.Name@EXAMPLE.COM  ")).toBe(
      "user.name@example.com",
    );
  });
});

describe("category name normalization", () => {
  it("preserves the display name but lowercases ASCII for comparison", () => {
    expect(normalizeCategoryName("  FAQ 가이드  ")).toEqual({
      name: "FAQ 가이드",
      nameKey: "faq 가이드",
    });
  });

  it("does not lowercase non-ASCII letters", () => {
    expect(normalizeCategoryName(" ÄA ")).toEqual({
      name: "ÄA",
      nameKey: "Äa",
    });
  });
});
