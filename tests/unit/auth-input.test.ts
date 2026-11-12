import { describe, expect, it } from "vitest";

import {
  parseLoginInput,
  parseSignupInput,
} from "../../apps/api/src/identity/auth-input.js";

describe("authentication input", () => {
  it("normalizes the email and display name without modifying the password", () => {
    expect(
      parseSignupInput({
        email: "  User@Example.com ",
        password: " password1234 ",
        displayName: "  사용자  ",
      }),
    ).toEqual({
      email: "user@example.com",
      password: " password1234 ",
      displayName: "사용자",
    });
  });

  it("rejects malformed, extra, or incorrectly typed input", () => {
    expect(parseLoginInput(null)).toBeUndefined();
    expect(
      parseLoginInput({ email: "a@@b", password: "password1234" }),
    ).toBeUndefined();
    expect(
      parseLoginInput({
        email: "a@b",
        password: "password1234",
        role: "owner",
      }),
    ).toBeUndefined();
    expect(
      parseSignupInput({
        email: "a@b",
        password: "password1234",
        displayName: 1,
      }),
    ).toBeUndefined();
    expect(
      parseSignupInput({
        email: "a@b",
        password: "password1234",
        displayName: " ",
      }),
    ).toBeUndefined();
  });

  it("enforces password boundaries using Unicode characters", () => {
    expect(
      parseLoginInput({ email: "a@b", password: "😀".repeat(11) }),
    ).toBeUndefined();
    expect(
      parseLoginInput({ email: "a@b", password: "😀".repeat(12) }),
    ).toBeDefined();
    expect(
      parseLoginInput({ email: "a@b", password: "😀".repeat(128) }),
    ).toBeDefined();
    expect(
      parseLoginInput({ email: "a@b", password: "😀".repeat(129) }),
    ).toBeUndefined();
  });

  it("enforces normalized email and trimmed display-name length limits", () => {
    const password = "password1234";
    expect(
      parseLoginInput({ email: `${"a".repeat(253)}@b`, password }),
    ).toBeDefined();
    expect(
      parseLoginInput({ email: `${"a".repeat(254)}@b`, password }),
    ).toBeUndefined();
    expect(
      parseSignupInput({
        email: "a@b",
        password,
        displayName: "가".repeat(100),
      }),
    ).toBeDefined();
    expect(
      parseSignupInput({
        email: "a@b",
        password,
        displayName: "가".repeat(101),
      }),
    ).toBeUndefined();
  });

  it("rejects malformed Unicode and control characters in persisted identifiers", () => {
    expect(
      parseLoginInput({ email: "a\u0000@b", password: "password1234" }),
    ).toBeUndefined();
    expect(
      parseLoginInput({ email: "a@b", password: "password123\uD800" }),
    ).toBeUndefined();
    expect(
      parseSignupInput({
        email: "a@b",
        password: "password1234",
        displayName: "name\u0000",
      }),
    ).toBeUndefined();
  });
});
