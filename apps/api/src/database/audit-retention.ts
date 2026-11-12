import type {
  Connection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise";

interface CutoffRow extends RowDataPacket {
  cutoff: string;
}

export async function cleanExpiredAuditLogs(connection: Connection) {
  await connection.beginTransaction();
  try {
    const [rows] = await connection.query<CutoffRow[]>(
      "SELECT DATE_FORMAT(UTC_TIMESTAMP(3) - INTERVAL 30 DAY, '%Y-%m-%d %H:%i:%s.%f') AS cutoff",
    );
    const cutoff = rows[0]?.cutoff;
    if (!cutoff) throw new Error("Could not determine audit retention cutoff");
    const [auth] = await connection.execute<ResultSetHeader>(
      "DELETE FROM auth_audit_logs WHERE created_at < ?",
      [cutoff],
    );
    const [organization] = await connection.execute<ResultSetHeader>(
      "DELETE FROM audit_logs WHERE created_at < ?",
      [cutoff],
    );
    await connection.commit();
    return {
      authDeleted: auth.affectedRows,
      organizationDeleted: organization.affectedRows,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  }
}
