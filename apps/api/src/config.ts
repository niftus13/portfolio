function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function portEnv(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined) {
    return fallback;
  }

  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} must be an integer between 1 and 65535`);
  }
  return port;
}

export const config = {
  host: process.env.HOST ?? "127.0.0.1",
  port: portEnv("PORT", 4000),
  database: {
    host: process.env.DB_HOST ?? "127.0.0.1",
    port: portEnv("DB_PORT", 3306),
    user: requiredEnv("DB_USER"),
    password: requiredEnv("DB_PASSWORD"),
    name: requiredEnv("DB_NAME"),
  },
};

export function authConfig() {
  const allowedOrigin = requiredEnv("AUTH_ALLOWED_ORIGIN");
  let url: URL;
  try {
    url = new URL(allowedOrigin);
  } catch {
    throw new Error("AUTH_ALLOWED_ORIGIN must be an absolute origin");
  }
  if (
    url.origin !== allowedOrigin ||
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      ))
  ) {
    throw new Error("AUTH_ALLOWED_ORIGIN must use HTTPS except for local HTTP");
  }
  const proxy = requiredEnv("AUTH_TRUST_PROXY");
  const trustProxy: string | false = proxy === "none" ? false : proxy;
  const auditFailureLog = requiredEnv("AUTH_AUDIT_FAILURE_LOG");
  if (!isAbsolute(auditFailureLog)) {
    throw new Error("AUTH_AUDIT_FAILURE_LOG must be an absolute path");
  }
  return {
    allowedOrigin,
    secure: url.protocol === "https:",
    trustProxy,
    auditFailureLog,
  };
}
import { isAbsolute } from "node:path";
