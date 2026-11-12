import mysql from "mysql2/promise";

import { config } from "../config.js";
import { seedDemo } from "../database/seed.js";

const password = process.env.SEED_DEMO_PASSWORD;
if (!password) {
  throw new Error("Missing required environment variable: SEED_DEMO_PASSWORD");
}

const connection = await mysql.createConnection({
  host: config.database.host,
  port: config.database.port,
  user: config.database.user,
  password: config.database.password,
  database: config.database.name,
});

try {
  const result = await seedDemo(connection, password);
  console.log(`Demo seed: ${result}`);
} finally {
  await connection.end();
}
