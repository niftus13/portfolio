import mysql from "mysql2/promise";

import { migrate } from "../../apps/api/src/database/migrate.js";

export default async function setup() {
  const database = process.env.TEST_DB_NAME;
  const port = Number(process.env.TEST_DB_PORT);
  if (
    !database ||
    !/^portfolio_test_[a-z0-9_]+$/.test(database) ||
    !process.env.TEST_DB_HOST ||
    !process.env.TEST_DB_USER ||
    !process.env.TEST_DB_PASSWORD ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  ) {
    throw new Error(
      "An isolated test database and valid TEST_DB_* variables are required",
    );
  }
  const connection = await mysql.createConnection({
    host: process.env.TEST_DB_HOST,
    port,
    user: process.env.TEST_DB_USER,
    password: process.env.TEST_DB_PASSWORD,
    database,
    multipleStatements: true,
  });
  try {
    await migrate(connection);
  } finally {
    await connection.end();
  }
}
