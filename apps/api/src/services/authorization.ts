import { randomUUID } from "node:crypto";

import type { DocumentRepository } from "../repositories/documents.js";
import { AuthError } from "./auth.js";

export class Denied extends AuthError {
  constructor(
    readonly tenantId: string,
    readonly userId: string,
    readonly action: string,
    readonly targetId: string | null,
  ) {
    super(403, "Forbidden");
  }
}

export async function recordDenial<T>(
  repository: DocumentRepository,
  work: () => Promise<T>,
): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof Denied) {
      const requestId = randomUUID();
      try {
        await repository.denied(
          error.tenantId,
          error.userId,
          error.action,
          error.targetId,
          requestId,
        );
      } catch (auditError) {
        console.error("Authorization denial audit failed", {
          requestId,
          code:
            typeof auditError === "object" &&
            auditError !== null &&
            "code" in auditError
              ? auditError.code
              : "UNKNOWN",
        });
      }
    }
    throw error;
  }
}
