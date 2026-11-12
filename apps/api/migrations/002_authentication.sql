CREATE TABLE csrf_states (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  preauth_hash BINARY(32) NULL UNIQUE,
  session_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL UNIQUE,
  token CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  KEY idx_csrf_expires (expires_at),
  CONSTRAINT fk_csrf_session FOREIGN KEY (session_id) REFERENCES sessions (id) ON DELETE RESTRICT,
  CONSTRAINT chk_csrf_binding CHECK ((preauth_hash IS NULL) <> (session_id IS NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE auth_rate_keys (
  scope VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  key_hash BINARY(32) NOT NULL,
  PRIMARY KEY (scope, key_hash)
) ENGINE=InnoDB;

CREATE TABLE auth_rate_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  scope VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  key_hash BINARY(32) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  KEY idx_rate_key_time (scope, key_hash, created_at),
  KEY idx_rate_time (created_at),
  CONSTRAINT fk_rate_key FOREIGN KEY (scope, key_hash) REFERENCES auth_rate_keys (scope, key_hash) ON DELETE RESTRICT
) ENGINE=InnoDB;
