"use strict";

const mysql = require("mysql2/promise");

/** @type {mysql.Pool | null} */
let pool = null;

function cfg() {
  return {
    host: process.env.MYSQL_HOST || "127.0.0.1",
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || "daily01",
    password: process.env.MYSQL_PASSWORD || "",
    database: process.env.MYSQL_DATABASE || "daily01",
    waitForConnections: true,
    connectionLimit: 10,
    namedPlaceholders: true,
    timezone: "Z",
  };
}

async function getPool() {
  if (!pool) {
    pool = mysql.createPool(cfg());
  }
  return pool;
}

async function ping() {
  const p = await getPool();
  const conn = await p.getConnection();
  try {
    await conn.ping();
  } finally {
    conn.release();
  }
}

async function columnExists(table, column) {
  const p = await getPool();
  const [rows] = await p.query(
    `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table AND COLUMN_NAME = :column`,
    { table, column }
  );
  return Number(rows[0]?.c || 0) > 0;
}

async function tableExists(table) {
  const p = await getPool();
  const [rows] = await p.query(
    `SELECT COUNT(*) AS c FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table`,
    { table }
  );
  return Number(rows[0]?.c || 0) > 0;
}

async function ensureSchema() {
  const p = await getPool();
  if (!(await columnExists("projects", "details"))) {
    await p.query(`ALTER TABLE projects ADD COLUMN details MEDIUMTEXT NULL`);
  }
  if (!(await columnExists("projects", "progress"))) {
    await p.query(`ALTER TABLE projects ADD COLUMN progress MEDIUMTEXT NULL`);
  }
  if (!(await columnExists("messages", "kind"))) {
    await p.query(`ALTER TABLE messages ADD COLUMN kind VARCHAR(32) NOT NULL DEFAULT 'chat'`);
  }
  if (!(await columnExists("messages", "title"))) {
    await p.query(`ALTER TABLE messages ADD COLUMN title VARCHAR(255) NULL`);
  }
  if (!(await columnExists("messages", "unread"))) {
    await p.query(`ALTER TABLE messages ADD COLUMN unread TINYINT(1) NOT NULL DEFAULT 0`);
  }
  if (!(await tableExists("app_meta"))) {
    await p.query(`
      CREATE TABLE app_meta (
        meta_key VARCHAR(64) PRIMARY KEY,
        meta_value VARCHAR(255) NOT NULL,
        updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
          ON UPDATE CURRENT_TIMESTAMP(3)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }
}

function buildTree(rows) {
  /** @type {Map<string, any>} */
  const map = new Map();
  for (const r of rows) {
    map.set(r.id, {
      id: r.id,
      name: r.name,
      createdAt: toISO(r.created_at),
      completedAt: r.completed_at ? toISO(r.completed_at) : null,
      completed: !!r.completed,
      archived: !!r.archived,
      collapsed: !!r.collapsed,
      details: r.details || "",
      progress: r.progress || "",
      children: [],
      _parent: r.parent_id || null,
      _order: r.sort_order,
    });
  }
  /** @type {any[]} */
  const roots = [];
  for (const node of map.values()) {
    if (node._parent && map.has(node._parent)) {
      map.get(node._parent).children.push(node);
    } else {
      roots.push(node);
    }
  }
  function sortRec(list) {
    list.sort((a, b) => a._order - b._order);
    for (const n of list) {
      sortRec(n.children);
      delete n._parent;
      delete n._order;
    }
  }
  sortRec(roots);
  return roots;
}

function toISO(v) {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString();
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

async function getProjects() {
  const p = await getPool();
  const [rows] = await p.query(
    `SELECT id, parent_id, name, created_at, completed_at, completed, archived, collapsed,
            sort_order, details, progress
     FROM projects ORDER BY sort_order ASC, created_at ASC`
  );
  return buildTree(rows);
}

async function saveProjects(tree) {
  const p = await getPool();
  const conn = await p.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query("SET FOREIGN_KEY_CHECKS = 0");
    await conn.query("DELETE FROM projects");
    await conn.query("SET FOREIGN_KEY_CHECKS = 1");

    /** @type {any[]} */
    const flat = [];
    function walk(list, parentId) {
      list.forEach((node, index) => {
        flat.push({
          id: String(node.id),
          parent_id: parentId,
          name: String(node.name || "").slice(0, 255),
          created_at: node.createdAt ? new Date(node.createdAt) : new Date(),
          completed_at: node.completedAt ? new Date(node.completedAt) : null,
          completed: node.completed ? 1 : 0,
          archived: node.archived ? 1 : 0,
          collapsed: node.collapsed ? 1 : 0,
          sort_order: index,
          details: node.details || "",
          progress: node.progress || "",
        });
        if (Array.isArray(node.children) && node.children.length) {
          walk(node.children, String(node.id));
        }
      });
    }
    walk(Array.isArray(tree) ? tree : [], null);

    for (const row of flat) {
      await conn.query(
        `INSERT INTO projects
          (id, parent_id, name, created_at, completed_at, completed, archived, collapsed, sort_order, details, progress)
         VALUES
          (:id, :parent_id, :name, :created_at, :completed_at, :completed, :archived, :collapsed, :sort_order, :details, :progress)`,
        row
      );
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function appendProjectProgress(projectId, block) {
  const p = await getPool();
  const [rows] = await p.query(`SELECT progress FROM projects WHERE id = :id`, { id: projectId });
  if (!rows.length) return false;
  const prev = rows[0].progress || "";
  const next = prev ? `${prev}\n\n${block}` : block;
  await p.query(`UPDATE projects SET progress = :progress WHERE id = :id`, {
    id: projectId,
    progress: next,
  });
  return true;
}

async function updateProjectDetails(projectId, details) {
  const p = await getPool();
  const [result] = await p.query(`UPDATE projects SET details = :details WHERE id = :id`, {
    id: projectId,
    details: details || "",
  });
  return result.affectedRows > 0;
}

async function getJournals() {
  const p = await getPool();
  const [rows] = await p.query(
    `SELECT entry_date, learning_json, improve_json, thoughts FROM journals`
  );
  /** @type {Record<string, any>} */
  const out = {};
  for (const r of rows) {
    const key =
      r.entry_date instanceof Date
        ? r.entry_date.toISOString().slice(0, 10)
        : String(r.entry_date).slice(0, 10);
    out[key] = {
      learning: parseJson(r.learning_json, []),
      improve: parseJson(r.improve_json, []),
      thoughts: r.thoughts || "",
    };
  }
  return out;
}

function parseJson(v, fallback) {
  if (v == null) return fallback;
  if (typeof v === "object") return v;
  try {
    return JSON.parse(v);
  } catch {
    return fallback;
  }
}

async function saveJournals(map) {
  const p = await getPool();
  const conn = await p.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query("DELETE FROM journals");
    const entries = Object.entries(map || {});
    for (const [date, entry] of entries) {
      await conn.query(
        `INSERT INTO journals (entry_date, learning_json, improve_json, thoughts, updated_at)
         VALUES (:entry_date, CAST(:learning AS JSON), CAST(:improve AS JSON), :thoughts, UTC_TIMESTAMP(3))`,
        {
          entry_date: date,
          learning: JSON.stringify(entry.learning || []),
          improve: JSON.stringify(entry.improve || []),
          thoughts: entry.thoughts || "",
        }
      );
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function deleteJournal(date) {
  const p = await getPool();
  await p.query(`DELETE FROM journals WHERE entry_date = :d`, { d: date });
}

async function cleanupOldMessages() {
  const p = await getPool();
  const [result] = await p.query(
    `DELETE FROM messages WHERE created_at < (UTC_TIMESTAMP(3) - INTERVAL 30 DAY)`
  );
  return result.affectedRows || 0;
}

async function getMessages() {
  await cleanupOldMessages();
  const p = await getPool();
  const [rows] = await p.query(
    `SELECT id, role, kind, title, content, unread, created_at
     FROM messages
     ORDER BY id ASC`
  );
  return rows.map((r) => ({
    id: String(r.id),
    role: r.role,
    kind: r.kind || "chat",
    title: r.title || null,
    content: r.content,
    unread: !!r.unread,
    createdAt: toISO(r.created_at),
  }));
}

async function insertMessage(role, content, opts = {}) {
  const p = await getPool();
  const kind = opts.kind || "chat";
  const title = opts.title || null;
  const unread = opts.unread ? 1 : 0;
  const [result] = await p.query(
    `INSERT INTO messages (role, kind, title, content, unread, created_at)
     VALUES (:role, :kind, :title, :content, :unread, UTC_TIMESTAMP(3))`,
    { role, kind, title, content, unread }
  );
  return {
    id: String(result.insertId),
    role,
    kind,
    title,
    content,
    unread: !!unread,
    createdAt: new Date().toISOString(),
  };
}

async function markMessageRead(id) {
  const p = await getPool();
  await p.query(`UPDATE messages SET unread = 0 WHERE id = :id`, { id });
}

async function countUnread() {
  const p = await getPool();
  const [rows] = await p.query(
    `SELECT COUNT(*) AS c FROM messages WHERE unread = 1 AND kind = 'weekly'`
  );
  return Number(rows[0]?.c || 0);
}

async function getRecentChatContext(limit = 40) {
  const p = await getPool();
  const [rows] = await p.query(
    `SELECT role, content FROM messages
     WHERE role IN ('user', 'assistant') AND kind = 'chat'
     ORDER BY id DESC
     LIMIT :limit`,
    { limit }
  );
  return rows.reverse().map((r) => ({ role: r.role, content: r.content }));
}

async function clearChatMessages() {
  const p = await getPool();
  const [result] = await p.query(`DELETE FROM messages WHERE kind = 'chat'`);
  return result.affectedRows || 0;
}

async function getMeta(key) {
  const p = await getPool();
  const [rows] = await p.query(`SELECT meta_value FROM app_meta WHERE meta_key = :key`, { key });
  return rows[0]?.meta_value || null;
}

async function setMeta(key, value) {
  const p = await getPool();
  await p.query(
    `INSERT INTO app_meta (meta_key, meta_value, updated_at)
     VALUES (:key, :value, UTC_TIMESTAMP(3))
     ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value), updated_at = UTC_TIMESTAMP(3)`,
    { key, value: String(value) }
  );
}

module.exports = {
  getPool,
  ping,
  ensureSchema,
  getProjects,
  saveProjects,
  appendProjectProgress,
  updateProjectDetails,
  getJournals,
  saveJournals,
  deleteJournal,
  getMessages,
  insertMessage,
  markMessageRead,
  countUnread,
  getRecentChatContext,
  clearChatMessages,
  cleanupOldMessages,
  getMeta,
  setMeta,
};
