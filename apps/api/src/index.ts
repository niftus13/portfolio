import { createServer } from "node:http";

import { createApp } from "./app.js";
import { config } from "./config.js";
import { checkDatabase, pool } from "./database.js";

const server = createServer(createApp({ checkDatabase }));

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
