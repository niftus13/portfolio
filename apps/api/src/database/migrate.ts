import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Connection, RowDataPacket } from "mysql2/promise";

import { withDatabaseLock } from "./lock.js";

interface MigrationRow extends RowDataPacket {
  name: string;
  checksum: string;
  state: "applying" | "applied";
}

const defaultDirectory = fileURLToPath(
  new URL("../../migrations/", import.meta.url),
);

export async function migrate(
  connection: Connection,
  directory = defaultDirectory,
): Promise<void> {
  await withDatabaseLock(connection, async () => {
    const names = (await readdir(directory)).filter((name) =>
      name.endsWith(".sql"),
    );
    if (names.some((name) => !/^\d{3,}_[a-z0-9_]+\.sql$/.test(name))) {
      throw new Error(
        "Migration filenames must use the NNN_description.sql format",
      );
    }
    const version = (name: string) => BigInt(name.split("_")[0]);
    if (new Set(names.map(version)).size !== names.length) {
      throw new Error("Migration version numbers must be unique");
    }
    names.sort((left, right) =>
      version(left) < version(right)
        ? -1
        : version(left) > version(right)
          ? 1
          : 0,
    );
    const migrations = await Promise.all(
      names.map(async (name) => {
        const sql = await readFile(join(directory, name), "utf8");
        return {
          name,
          sql,
          checksum: createHash("sha256").update(sql).digest("hex"),
        };
      }),
    );

    await connection.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
      checksum CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      state VARCHAR(20) NOT NULL,
      applied_at DATETIME(3) NULL
    ) ENGINE=InnoDB`);
    const [rows] = await connection.query<MigrationRow[]>(
      "SELECT name, checksum, state FROM schema_migrations ORDER BY name",
    );
    for (const row of rows) {
      const migration = migrations.find((item) => item.name === row.name);
      if (!migration || migration.checksum !== row.checksum) {
        throw new Error(`Applied migration is missing or changed: ${row.name}`);
      }
      if (row.state !== "applied") {
        throw new Error(
          `Incomplete migration requires manual recovery: ${row.name}`,
        );
      }
    }

    const applied = new Set(rows.map((row) => row.name));
    const newestApplied = rows.reduce<bigint | undefined>(
      (latest, row) =>
        latest === undefined || version(row.name) > latest
          ? version(row.name)
          : latest,
      undefined,
    );
    for (const migration of migrations) {
      if (applied.has(migration.name)) continue;
      if (
        newestApplied !== undefined &&
        version(migration.name) < newestApplied
      ) {
        throw new Error(`Out-of-order migration: ${migration.name}`);
      }
      await connection.execute(
        "INSERT INTO schema_migrations (name, checksum, state) VALUES (?, ?, 'applying')",
        [migration.name, migration.checksum],
      );
      await connection.query(migration.sql);
      await connection.execute(
        "UPDATE schema_migrations SET state = 'applied', applied_at = UTC_TIMESTAMP(3) WHERE name = ?",
        [migration.name],
      );
    }
  });
}
