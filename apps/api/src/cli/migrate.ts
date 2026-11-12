import mysql from "mysql2/promise";

import { config } from "../config.js";
import { migrate } from "../database/migrate.js";

const connection = await mysql.createConnection({
  host: config.database.host,
  port: config.database.port,
  user: config.database.user,
  password: config.database.password,
  database: config.database.name,
  multipleStatements: true,
});

try {
  await migrate(connection);
  console.log("Migrations applied");
} finally {
  await connection.end();
}
