import type { PoolConnection } from "mysql2/promise";

import {
  DocumentRepository,
  type Organization,
  type Role,
} from "../repositories/documents.js";
import { MemberRepository, type MemberRow } from "../repositories/members.js";
import { AuthError } from "./auth.js";
import { Denied, recordDenial } from "./authorization.js";

function memberResponse(member: MemberRow) {
  return {
    id: member.id,
    email: member.email,
    displayName: member.display_name,
    role: member.role,
    status: member.status,
  };
}

export class MemberService {
  constructor(
    private readonly tenants: DocumentRepository,
    private readonly members: MemberRepository,
  ) {}

  private async organization(
    userId: string,
    slug: string,
    connection?: PoolConnection,
  ): Promise<Organization> {
    const organization = await this.tenants.organization(
      userId,
      slug,
      connection,
    );
    if (!organization) throw new AuthError(404, "Not found");
    return organization;
  }

  private manager(
    organization: Organization,
    userId: string,
    action: string,
    id: string | null,
  ) {
    if (organization.role !== "owner" && organization.role !== "admin") {
      throw new Denied(organization.id, userId, action, id);
    }
  }

  async list(userId: string, slug: string) {
    return recordDenial(this.tenants, async () => {
      const organization = await this.organization(userId, slug);
      this.manager(organization, userId, "member.list", null);
      return (await this.members.list(organization.id)).map(memberResponse);
    });
  }

  async update(
    userId: string,
    slug: string,
    id: string,
    role: Exclude<Role, "owner">,
    status: "active" | "inactive",
  ) {
    return recordDenial(this.tenants, () =>
      this.tenants.transaction(async (connection) => {
        const organization = await this.organization(userId, slug, connection);
        const member = await this.members.member(
          connection,
          organization.id,
          id,
        );
        if (!member) throw new AuthError(404, "Not found");
        this.manager(organization, userId, "member.update", id);
        if (
          organization.is_demo === 1 ||
          member.role === "owner" ||
          (organization.role === "admin" &&
            (member.role === "admin" || role === "admin"))
        ) {
          throw new Denied(organization.id, userId, "member.update", id);
        }
        if (member.role === role && member.status === status)
          return memberResponse(member);
        await this.members.update(
          connection,
          organization.id,
          id,
          role,
          status,
        );
        await this.members.audit(connection, organization.id, userId, id);
        const updated = await this.members.member(
          connection,
          organization.id,
          id,
        );
        if (!updated) throw new Error("Updated membership disappeared");
        return memberResponse(updated);
      }),
    );
  }

  async auditEvents(userId: string, slug: string) {
    return recordDenial(this.tenants, async () => {
      const organization = await this.organization(userId, slug);
      this.manager(organization, userId, "audit.list", null);
      return (await this.members.auditEvents(organization.id)).map((row) => ({
        id: row.id,
        actorUserId: row.actor_user_id,
        action: row.action,
        targetType: row.target_type,
        targetId: row.target_id,
        success: row.success === 1,
        requestId: row.request_id,
        createdAt: row.created_at,
      }));
    });
  }
}
