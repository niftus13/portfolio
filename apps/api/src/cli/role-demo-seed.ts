import mysql from "mysql2/promise";

import { config } from "../config.js";
import { seedRoleDemo } from "../database/role-demo-seed.js";

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
  const result = await seedRoleDemo(connection, password);
  console.log(`Role demo seed: ${result}`);
} finally {
  await connection.end();
}
