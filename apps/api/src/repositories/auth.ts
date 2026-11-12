import { randomUUID } from "node:crypto";

import type {
  Pool,
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise";

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
}

interface UserRow extends RowDataPacket {
  id: string;
  email: string;
  display_name: string;
  password_hash: string;
  status: string;
}

interface SessionRow extends UserRow {
  session_id: string;
  csrf_token: string;
}

interface CsrfRow extends RowDataPacket {
  token: string;
}

interface MembershipRow extends RowDataPacket {
  id: string;
}

interface RateRow extends RowDataPacket {
  count: number;
  retry_seconds: number;
}

export interface Session {
  id: string;
  user: AuthUser;
  csrfToken: string;
}

export interface RateKey {
  scope: string;
  hash: Buffer;
  max: number;
  seconds: number;
}

export class AuditWriteError extends Error {
  constructor(cause: unknown) {
    super("Authentication audit write failed", { cause });
  }
}

function mapUser(row: UserRow): AuthUser {
  return { id: row.id, email: row.email, displayName: row.display_name };
}

export class AuthRepository {
  constructor(private readonly pool: Pool) {}

  async findUser(email: string): Promise<UserRow | undefined> {
    const [rows] = await this.pool.execute<UserRow[]>(
      "SELECT id, email, display_name, password_hash, status FROM users WHERE email = ?",
      [email],
    );
    return rows[0];
  }

  async hasOrganizations(userId: string): Promise<boolean> {
    const [rows] = await this.pool.execute<MembershipRow[]>(
      "SELECT id FROM memberships WHERE user_id = ? AND status = 'active' LIMIT 1",
      [userId],
    );
    return rows.length > 0;
  }

  async createUser(
    id: string,
    email: string,
    passwordHash: string,
    displayName: string,
  ): Promise<void> {
    await this.pool.execute(
      `INSERT INTO users (id, email, password_hash, display_name, status, is_demo, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'active', 0, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [id, email, passwordHash, displayName],
    );
  }

  async preauthToken(hash: Buffer): Promise<string | undefined> {
    const [rows] = await this.pool.execute<CsrfRow[]>(
      "SELECT token FROM csrf_states WHERE preauth_hash = ? AND expires_at > UTC_TIMESTAMP(3)",
      [hash],
    );
    return rows[0]?.token;
  }

  async createPreauth(hash: Buffer, token: string): Promise<void> {
    await this.pool.execute(
      `INSERT INTO csrf_states (id, preauth_hash, token, expires_at, created_at)
       VALUES (?, ?, ?, UTC_TIMESTAMP(3) + INTERVAL 30 MINUTE, UTC_TIMESTAMP(3))`,
      [randomUUID(), hash, token],
    );
  }

  async session(hash: Buffer): Promise<Session | undefined> {
    const [updated] = await this.pool.execute<ResultSetHeader>(
      `UPDATE sessions s JOIN users u ON u.id = s.user_id
       SET s.last_activity_at = UTC_TIMESTAMP(3)
       WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > UTC_TIMESTAMP(3)
         AND s.last_activity_at > UTC_TIMESTAMP(3) - INTERVAL 2 HOUR
         AND u.status = 'active'`,
      [hash],
    );
    if (updated.affectedRows !== 1) return undefined;
    const [rows] = await this.pool.execute<SessionRow[]>(
      `SELECT s.id AS session_id, u.id, u.email, u.display_name, u.password_hash,
              u.status, c.token AS csrf_token
       FROM sessions s JOIN users u ON u.id = s.user_id
       JOIN csrf_states c ON c.session_id = s.id
       WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > UTC_TIMESTAMP(3)
         AND s.last_activity_at > UTC_TIMESTAMP(3) - INTERVAL 2 HOUR
         AND c.expires_at > UTC_TIMESTAMP(3) AND u.status = 'active'`,
      [hash],
    );
    const row = rows[0];
    return row
      ? { id: row.session_id, user: mapUser(row), csrfToken: row.csrf_token }
      : undefined;
  }

  async rateLimit(keys: RateKey[]): Promise<number | undefined> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const sorted = [...keys].sort((a, b) => a.scope.localeCompare(b.scope));
      for (const key of sorted) {
        await connection.execute(
          "INSERT INTO auth_rate_keys (scope, key_hash) VALUES (?, ?) ON DUPLICATE KEY UPDATE scope = VALUES(scope)",
          [key.scope, key.hash],
        );
      }
      let retry = 0;
      for (const key of sorted) {
        await connection.execute(
          "DELETE FROM auth_rate_events WHERE scope = ? AND key_hash = ? AND created_at <= UTC_TIMESTAMP(3) - INTERVAL ? SECOND",
          [key.scope, key.hash, key.seconds],
        );
        const [rows] = await connection.execute<RateRow[]>(
          `SELECT COUNT(*) AS count,
                  CEIL(TIMESTAMPDIFF(MICROSECOND, UTC_TIMESTAMP(3), MIN(created_at) + INTERVAL ? SECOND) / 1000000) AS retry_seconds
           FROM auth_rate_events WHERE scope = ? AND key_hash = ?`,
          [key.seconds, key.scope, key.hash],
        );
        if (Number(rows[0].count) >= key.max) {
          retry = Math.max(retry, Number(rows[0].retry_seconds), 1);
        }
      }
      if (retry === 0) {
        for (const key of sorted) {
          await connection.execute(
            "INSERT INTO auth_rate_events (scope, key_hash, created_at) VALUES (?, ?, UTC_TIMESTAMP(3))",
            [key.scope, key.hash],
          );
        }
      }
      await connection.commit();
      return retry || undefined;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  protected async audit(
    connection: Pool | PoolConnection,
    action: string,
    success: boolean,
    userId: string | null,
    requestId: string,
  ): Promise<void> {
    await connection.execute(
      `INSERT INTO auth_audit_logs (id, actor_user_id, action, success, request_id, created_at)
       VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP(3))`,
      [randomUUID(), userId, action, success, requestId],
    );
  }

  async failedLogin(requestId: string): Promise<void> {
    await this.audit(this.pool, "login", false, null, requestId);
  }

  async createSession(
    userId: string,
    tokenHash: Buffer,
    csrfToken: string,
    preauthHash: Buffer,
    previousCsrfToken: string,
    requestId: string,
  ): Promise<boolean> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [states] = await connection.execute<CsrfRow[]>(
        `SELECT token FROM csrf_states WHERE preauth_hash = ? AND token = ?
         AND expires_at > UTC_TIMESTAMP(3) FOR UPDATE`,
        [preauthHash, previousCsrfToken],
      );
      if (states.length !== 1) {
        await connection.rollback();
        return false;
      }
      const id = randomUUID();
      try {
        await this.audit(connection, "login", true, userId, requestId);
      } catch (error) {
        throw new AuditWriteError(error);
      }
      const [created] = await connection.execute<ResultSetHeader>(
        `INSERT INTO sessions (id, user_id, token_hash, last_activity_at, expires_at, created_at)
         SELECT ?, id, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3) + INTERVAL 24 HOUR, UTC_TIMESTAMP(3)
         FROM users WHERE id = ? AND status = 'active'`,
        [id, tokenHash, userId],
      );
      if (created.affectedRows !== 1) {
        await connection.rollback();
        return false;
      }
      await connection.execute(
        `INSERT INTO csrf_states (id, session_id, token, expires_at, created_at)
         VALUES (?, ?, ?, UTC_TIMESTAMP(3) + INTERVAL 24 HOUR, UTC_TIMESTAMP(3))`,
        [randomUUID(), id, csrfToken],
      );
      await connection.execute(
        "DELETE FROM csrf_states WHERE preauth_hash = ?",
        [preauthHash],
      );
      await connection.commit();
      return true;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async revokeSession(id: string): Promise<boolean> {
    const [result] = await this.pool.execute<ResultSetHeader>(
      "UPDATE sessions SET revoked_at = UTC_TIMESTAMP(3) WHERE id = ? AND revoked_at IS NULL",
      [id],
    );
    return result.affectedRows === 1;
  }

  async logoutAudit(userId: string, requestId: string): Promise<void> {
    await this.audit(this.pool, "logout", true, userId, requestId);
  }
}
