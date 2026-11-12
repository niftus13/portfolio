import { normalizeEmail } from "./normalize-email.js";

export interface LoginInput {
  email: string;
  password: string;
}

export interface SignupInput extends LoginInput {
  displayName: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function containsControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
}

function validEmail(value: string): boolean {
  return (
    Array.from(value).length <= 255 &&
    !containsControlCharacters(value) &&
    !/[\uD800-\uDFFF]/u.test(value) &&
    /^[^\s@]+@[^\s@]+$/u.test(value)
  );
}

function validPassword(value: string): boolean {
  const length = Array.from(value).length;
  return length >= 12 && length <= 128 && !/[\uD800-\uDFFF]/u.test(value);
}

export function parseLoginInput(value: unknown): LoginInput | undefined {
  if (
    !isRecord(value) ||
    Object.keys(value).some((key) => key !== "email" && key !== "password") ||
    typeof value.email !== "string" ||
    typeof value.password !== "string"
  ) {
    return undefined;
  }
  const email = normalizeEmail(value.email);
  if (!validEmail(email) || !validPassword(value.password)) return undefined;
  return { email, password: value.password };
}

export function parseSignupInput(value: unknown): SignupInput | undefined {
  if (
    !isRecord(value) ||
    Object.keys(value).some(
      (key) => key !== "email" && key !== "password" && key !== "displayName",
    ) ||
    typeof value.displayName !== "string"
  ) {
    return undefined;
  }
  const login = parseLoginInput({
    email: value.email,
    password: value.password,
  });
  const displayName = value.displayName.trim();
  const length = Array.from(displayName).length;
  if (
    !login ||
    length < 1 ||
    length > 100 ||
    containsControlCharacters(displayName) ||
    /[\uD800-\uDFFF]/u.test(displayName)
  ) {
    return undefined;
  }
  return { ...login, displayName };
}
