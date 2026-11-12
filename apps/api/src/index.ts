import { createServer } from "node:http";
import { open } from "node:fs/promises";

import { createApp } from "./app.js";
import { authConfig, config } from "./config.js";
import { checkDatabase, pool } from "./database.js";
import { AuthRepository } from "./repositories/auth.js";
import { DocumentRepository } from "./repositories/documents.js";
import { AuthService } from "./services/auth.js";
import { DocumentService } from "./services/documents.js";

const auth = authConfig();
const auditFile = await open(auth.auditFailureLog, "a", 0o600);
await auditFile.close();
const service = new AuthService(new AuthRepository(pool), auth.auditFailureLog);
const server = createServer(
  createApp({
    checkDatabase,
    auth: { ...auth, service },
    documents: new DocumentService(new DocumentRepository(pool)),
  }),
);

server.listen(config.port, config.host, () => {
  console.info(`API listening on http://${config.host}:${config.port}`);
});

function shutdown(signal: string): void {
  console.info(`${signal} received; closing API`);
  server.close((error) => {
    if (error) {
      console.error("Failed to close API server", error);
      process.exitCode = 1;
    }
    void pool.end().then(
      () => {
        process.exit(process.exitCode ?? 0);
      },
      (poolError: unknown) => {
        console.error("Failed to close MySQL pool", poolError);
        process.exit(1);
      },
    );
  });
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
