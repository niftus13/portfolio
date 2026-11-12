import mysql from "mysql2/promise";

import { config } from "../config.js";
import { cleanExpiredAuditLogs } from "../database/audit-retention.js";

const connection = await mysql.createConnection({
  host: config.database.host,
  port: config.database.port,
  user: config.database.user,
  password: config.database.password,
  database: config.database.name,
});

try {
  const result = await cleanExpiredAuditLogs(connection);
  console.log("Expired audit records removed", result);
} catch (error) {
  console.error("Audit retention cleanup failed", {
    code:
      typeof error === "object" && error !== null && "code" in error
        ? error.code
        : "UNKNOWN",
  });
  process.exitCode = 1;
} finally {
  await connection.end();
}
