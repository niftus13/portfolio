CREATE TABLE users (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  email VARCHAR(255) COLLATE utf8mb4_0900_bin NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  display_name VARCHAR(100) NOT NULL,
  status VARCHAR(20) NOT NULL,
  is_demo BOOLEAN NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_users_id_demo (id, is_demo),
  CONSTRAINT chk_users_status CHECK (status IN ('active', 'suspended')),
  CONSTRAINT chk_users_demo CHECK (is_demo IN (0, 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE tenants (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  slug VARCHAR(100) COLLATE utf8mb4_0900_bin NOT NULL UNIQUE,
  name VARCHAR(200) NOT NULL,
  is_demo BOOLEAN NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_tenants_id_demo (id, is_demo),
  CONSTRAINT chk_tenants_demo CHECK (is_demo IN (0, 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE memberships (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  is_demo BOOLEAN NOT NULL,
  role VARCHAR(20) NOT NULL,
  status VARCHAR(20) NOT NULL,
  deactivated_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_memberships_tenant_user (tenant_id, user_id),
  KEY idx_memberships_user_status_tenant (user_id, status, tenant_id),
  KEY idx_memberships_tenant_status_role (tenant_id, status, role),
  CONSTRAINT fk_memberships_tenant FOREIGN KEY (tenant_id, is_demo) REFERENCES tenants (id, is_demo) ON DELETE RESTRICT,
  CONSTRAINT fk_memberships_user FOREIGN KEY (user_id, is_demo) REFERENCES users (id, is_demo) ON DELETE RESTRICT,
  CONSTRAINT chk_memberships_role CHECK (role IN ('owner', 'admin', 'editor', 'viewer')),
  CONSTRAINT chk_memberships_status CHECK (
    (status = 'active' AND deactivated_at IS NULL) OR
    (status = 'inactive' AND deactivated_at IS NOT NULL)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE sessions (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  token_hash BINARY(32) NOT NULL UNIQUE,
  last_activity_at DATETIME(3) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  revoked_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL,
  KEY idx_sessions_user (user_id),
  KEY idx_sessions_expires (expires_at),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE categories (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  name VARCHAR(100) NOT NULL,
  name_key VARCHAR(100) COLLATE utf8mb4_0900_bin NOT NULL,
  deleted_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_categories_tenant_id (tenant_id, id),
  UNIQUE KEY uq_categories_tenant_name_key (tenant_id, name_key),
  KEY idx_categories_listing (tenant_id, deleted_at, name),
  CONSTRAINT fk_categories_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE documents (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  category_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  created_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  title VARCHAR(255) NOT NULL,
  content_md MEDIUMTEXT NOT NULL,
  content_version BIGINT UNSIGNED NOT NULL,
  revision BIGINT UNSIGNED NOT NULL,
  deleted_at DATETIME(3) NULL,
  deleted_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_documents_tenant_id (tenant_id, id),
  KEY idx_documents_listing (tenant_id, deleted_at, updated_at, id),
  KEY idx_documents_category (tenant_id, category_id, deleted_at),
  CONSTRAINT fk_documents_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_documents_category FOREIGN KEY (tenant_id, category_id) REFERENCES categories (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_documents_creator FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_documents_deleter FOREIGN KEY (deleted_by) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE document_versions (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  document_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  version BIGINT UNSIGNED NOT NULL,
  title VARCHAR(255) NOT NULL,
  content_md MEDIUMTEXT NOT NULL,
  category_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  category_name_snapshot VARCHAR(100) NULL,
  changed_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  change_type VARCHAR(20) NOT NULL,
  restored_from_version BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_versions_tenant_document_version (tenant_id, document_id, version),
  KEY idx_versions_category (tenant_id, category_id),
  CONSTRAINT fk_versions_document FOREIGN KEY (tenant_id, document_id) REFERENCES documents (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_versions_category FOREIGN KEY (tenant_id, category_id) REFERENCES categories (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_versions_author FOREIGN KEY (changed_by) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT chk_versions_change_type CHECK (change_type IN ('create', 'update', 'restore', 'trash_restore'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE auth_audit_logs (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  actor_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  action VARCHAR(60) NOT NULL,
  target_type VARCHAR(40) NULL,
  target_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  success BOOLEAN NOT NULL,
  request_id VARCHAR(64) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  KEY idx_auth_audit_actor_time (actor_user_id, created_at),
  KEY idx_auth_audit_action_time (action, created_at),
  KEY idx_auth_audit_time (created_at),
  KEY idx_auth_audit_request (request_id),
  CONSTRAINT fk_auth_audit_actor FOREIGN KEY (actor_user_id) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE audit_logs (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  actor_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  action VARCHAR(60) NOT NULL,
  target_type VARCHAR(40) NULL,
  target_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  success BOOLEAN NOT NULL,
  request_id VARCHAR(64) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  KEY idx_audit_tenant_time (tenant_id, created_at),
  KEY idx_audit_tenant_target (tenant_id, target_type, target_id, created_at),
  KEY idx_audit_time (created_at),
  KEY idx_audit_request (request_id),
  CONSTRAINT fk_audit_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_audit_actor FOREIGN KEY (actor_user_id) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE seed_history (
  name VARCHAR(100) COLLATE utf8mb4_0900_bin NOT NULL PRIMARY KEY,
  applied_at DATETIME(3) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
