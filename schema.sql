CREATE DATABASE IF NOT EXISTS daily01
  DEFAULT CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE daily01;

CREATE TABLE IF NOT EXISTS projects (
  id VARCHAR(64) PRIMARY KEY,
  parent_id VARCHAR(64) NULL,
  name VARCHAR(255) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  completed_at DATETIME(3) NULL,
  completed TINYINT(1) NOT NULL DEFAULT 0,
  archived TINYINT(1) NOT NULL DEFAULT 0,
  collapsed TINYINT(1) NOT NULL DEFAULT 0,
  sort_order INT NOT NULL DEFAULT 0,
  details MEDIUMTEXT NULL,
  progress MEDIUMTEXT NULL,
  INDEX idx_projects_parent (parent_id),
  CONSTRAINT fk_projects_parent
    FOREIGN KEY (parent_id) REFERENCES projects(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS journals (
  entry_date DATE PRIMARY KEY,
  learning_json JSON NOT NULL,
  improve_json JSON NOT NULL,
  thoughts TEXT NOT NULL,
  updated_at DATETIME(3) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS messages (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  role ENUM('user', 'assistant', 'system') NOT NULL,
  kind VARCHAR(32) NOT NULL DEFAULT 'chat',
  title VARCHAR(255) NULL,
  content MEDIUMTEXT NOT NULL,
  unread TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_messages_created (created_at),
  INDEX idx_messages_kind (kind)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS app_meta (
  meta_key VARCHAR(64) PRIMARY KEY,
  meta_value VARCHAR(255) NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
