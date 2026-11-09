import mysql from "mysql2/promise";

import { config } from "./config.js";

export const pool = mysql.createPool({
  host: config.database.host,
  port: config.database.port,
  user: config.database.user,
  password: config.database.password,
  database: config.database.name,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

export async function checkDatabase(): Promise<void> {
  await pool.query("SELECT 1");
}
