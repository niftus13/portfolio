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
