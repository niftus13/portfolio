import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { appendFile } from "node:fs/promises";

import type { LoginInput, SignupInput } from "../identity/auth-input.js";
import { hashPassword, verifyPassword } from "../identity/password.js";
import {
  AuditWriteError,
  AuthRepository,
  type AuthUser,
  type Session,
} from "../repositories/auth.js";

export class AuthError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly retryAfter?: number,
  ) {
    super(message);
  }
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function token(): string {
  return randomBytes(32).toString("hex");
}

function validToken(value: string | undefined): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function tokensEqual(actual: string | undefined, expected: string): boolean {
  return (
    validToken(actual) &&
    timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"))
  );
}

const dummyHash = `scrypt$${"00".repeat(16)}$${"00".repeat(64)}`;

export class AuthService {
  constructor(
    private readonly repository: AuthRepository,
    private readonly auditFailureLog: string,
    private readonly requestId: () => string = randomUUID,
  ) {}

  private async logAuditFailure(
    action: string,
    requestId: string,
  ): Promise<void> {
    const entry = JSON.stringify({
      timestamp: new Date().toISOString(),
      event: "authentication_audit_failure",
      action,
      requestId,
    });
    try {
      await appendFile(this.auditFailureLog, `${entry}\n`, { mode: 0o600 });
    } catch (error) {
      console.error(
        "Authentication audit failure could not be written to log",
        {
          requestId,
          code:
            typeof error === "object" && error !== null && "code" in error
              ? error.code
              : "UNKNOWN",
        },
      );
    }
  }

  async session(
    sessionToken: string | undefined,
  ): Promise<Session | undefined> {
    return validToken(sessionToken)
      ? this.repository.session(digest(sessionToken))
      : undefined;
  }

  async hasOrganizations(userId: string): Promise<boolean> {
    return this.repository.hasOrganizations(userId);
  }

  async csrf(
    sessionToken: string | undefined,
    preauthToken: string | undefined,
  ): Promise<{ csrfToken: string; preauthToken?: string }> {
    const session = await this.session(sessionToken);
    if (session) return { csrfToken: session.csrfToken };
    if (validToken(preauthToken)) {
      const current = await this.repository.preauthToken(digest(preauthToken));
      if (current) return { csrfToken: current };
    }
    const nextPreauth = token();
    const csrfToken = token();
    await this.repository.createPreauth(digest(nextPreauth), csrfToken);
    return { csrfToken, preauthToken: nextPreauth };
  }

  async requireCsrf(
    sessionToken: string | undefined,
    preauthToken: string | undefined,
    supplied: string | undefined,
  ): Promise<Session | undefined> {
    const session = await this.session(sessionToken);
    if (session) {
      if (!tokensEqual(supplied, session.csrfToken)) {
        throw new AuthError(403, "Invalid CSRF token");
      }
      return session;
    }
    const expected = validToken(preauthToken)
      ? await this.repository.preauthToken(digest(preauthToken))
      : undefined;
    if (!expected || !tokensEqual(supplied, expected)) {
      throw new AuthError(403, "Invalid CSRF token");
    }
    return undefined;
  }

  private async rateLimit(
    ip: string,
    email: string | undefined,
    signup: boolean,
  ): Promise<void> {
    const keys = signup
      ? [{ scope: "signup_ip", hash: digest(ip), max: 5, seconds: 3600 }]
      : [
          { scope: "login_ip", hash: digest(ip), max: 30, seconds: 900 },
          ...(email
            ? [
                {
                  scope: "login_account",
                  hash: digest(email),
                  max: 10,
                  seconds: 900,
                },
              ]
            : []),
        ];
    const retry = await this.repository.rateLimit(keys);
    if (retry) throw new AuthError(429, "Too many attempts", retry);
  }

  async invalidAttempt(ip: string, signup: boolean): Promise<void> {
    await this.rateLimit(ip, undefined, signup);
  }

  async signup(input: SignupInput, ip: string): Promise<string> {
    await this.rateLimit(ip, input.email, true);
    const passwordHash = await hashPassword(input.password);
    const id = randomUUID();
    try {
      await this.repository.createUser(
        id,
        input.email,
        passwordHash,
        input.displayName,
      );
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ER_DUP_ENTRY"
      ) {
        if (await this.repository.findUser(input.email)) {
          throw new AuthError(409, "Email already registered");
        }
      }
      throw error;
    }
    return id;
  }

  async login(
    input: LoginInput,
    ip: string,
    preauth: string | undefined,
    csrfToken: string | undefined,
  ): Promise<{ user: AuthUser; sessionToken: string; csrfToken: string }> {
    await this.rateLimit(ip, input.email, false);
    const user = await this.repository.findUser(input.email);
    const passwordMatches = await verifyPassword(
      input.password,
      user?.password_hash ?? dummyHash,
    );
    const requestId = this.requestId();
    if (!user || user.status !== "active" || !passwordMatches) {
      try {
        await this.repository.failedLogin(requestId);
      } catch {
        await this.logAuditFailure("login_failure", requestId);
      }
      throw new AuthError(401, "Invalid credentials");
    }
    if (!validToken(preauth) || !validToken(csrfToken)) {
      throw new AuthError(403, "Invalid CSRF token");
    }
    const sessionToken = token();
    const nextCsrf = token();
    let created: boolean;
    try {
      created = await this.repository.createSession(
        user.id,
        digest(sessionToken),
        nextCsrf,
        digest(preauth),
        csrfToken,
        requestId,
      );
    } catch (error) {
      if (error instanceof AuditWriteError) {
        await this.logAuditFailure("login", requestId);
      }
      throw error;
    }
    if (!created) throw new AuthError(403, "Invalid CSRF token");
    return {
      user: { id: user.id, email: user.email, displayName: user.display_name },
      sessionToken,
      csrfToken: nextCsrf,
    };
  }

  async logout(session: Session): Promise<void> {
    if (!(await this.repository.revokeSession(session.id))) {
      throw new AuthError(401, "Authentication required");
    }
    const requestId = this.requestId();
    try {
      await this.repository.logoutAudit(session.user.id, requestId);
    } catch {
      await this.logAuditFailure("logout", requestId);
    }
  }
}
