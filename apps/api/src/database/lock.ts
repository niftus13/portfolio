import { createHash } from "node:crypto";

import type { Connection, RowDataPacket } from "mysql2/promise";

interface DatabaseRow extends RowDataPacket {
  database_name: string | null;
}

interface LockRow extends RowDataPacket {
  acquired: number | string | null;
}

function acquired(value: LockRow["acquired"] | undefined): boolean {
  return value === 1 || value === "1";
}

export async function withDatabaseLock<T>(
  connection: Connection,
  task: () => Promise<T>,
): Promise<T> {
  const [databases] = await connection.query<DatabaseRow[]>(
    "SELECT DATABASE() AS database_name",
  );
  const database = databases[0]?.database_name;
  if (!database) {
    throw new Error(
      "A database must be selected before running this operation",
    );
  }

  const key = `portfolio:${createHash("sha256").update(database).digest("hex").slice(0, 48)}`;
  const [locks] = await connection.query<LockRow[]>(
    "SELECT GET_LOCK(?, 10) AS acquired",
    [key],
  );
  if (!acquired(locks[0]?.acquired)) {
    throw new Error("Could not acquire the database operation lock");
  }

  let result!: T;
  let taskError: unknown;
  let taskFailed = false;
  try {
    result = await task();
  } catch (error) {
    taskFailed = true;
    taskError = error;
  }

  try {
    const [results] = await connection.query<LockRow[]>(
      "SELECT RELEASE_LOCK(?) AS acquired",
      [key],
    );
    if (!acquired(results[0]?.acquired)) {
      throw new Error("Could not release the database operation lock");
    }
  } catch (error) {
    if (taskFailed) {
      throw new AggregateError(
        [taskError, error],
        "Database operation and lock release failed",
        { cause: error },
      );
    }
    throw error;
  }
  if (taskFailed) throw taskError;
  return result;
}
