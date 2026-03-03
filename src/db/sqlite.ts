import { Database } from 'bun:sqlite';
import config from '../config.ts';

let db: Database;

export function initDB(): Database {
  db = new Database(config.dbPath, { create: true });
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS contacts (
      phone TEXT PRIMARY KEY,
      name TEXT,
      is_whitelisted INTEGER DEFAULT 0,
      is_blacklisted INTEGER DEFAULT 0,
      spam_trigger_count INTEGER DEFAULT 0,
      last_spam_trigger TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      contact_phone TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'new',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (contact_phone) REFERENCES contacts(phone)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      action_json TEXT,
      timestamp TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (conversation_id) REFERENCES conversations(id)
    );

    CREATE INDEX IF NOT EXISTS idx_conversations_contact
      ON conversations(contact_phone, status);
    CREATE INDEX IF NOT EXISTS idx_messages_conversation
      ON messages(conversation_id);
  `);

  // Seed whitelist contacts
  const upsertContact = db.prepare(
    `INSERT INTO contacts (phone, is_whitelisted) VALUES (?, 1)
     ON CONFLICT(phone) DO UPDATE SET is_whitelisted = 1`
  );
  for (const num of config.whitelistNumbers) {
    upsertContact.run(num);
  }

  return db;
}

export function getDB(): Database {
  if (!db) throw new Error('Database not initialized. Call initDB() first.');
  return db;
}

// --- Contact helpers ---

interface ContactRow {
  phone: string;
  name: string | null;
  is_whitelisted: number;
  is_blacklisted: number;
  spam_trigger_count: number;
  last_spam_trigger: string | null;
  created_at: string;
}

export function getOrCreateContact(phone: string, name?: string): ContactRow {
  const existing = getDB()
    .prepare('SELECT * FROM contacts WHERE phone = ?')
    .get(phone) as ContactRow | null;

  if (existing) {
    if (name && name !== existing.name) {
      getDB().prepare('UPDATE contacts SET name = ? WHERE phone = ?').run(name, phone);
    }
    return { ...existing, name: name ?? existing.name };
  }

  getDB()
    .prepare('INSERT INTO contacts (phone, name) VALUES (?, ?)')
    .run(phone, name ?? null);

  return getDB()
    .prepare('SELECT * FROM contacts WHERE phone = ?')
    .get(phone) as ContactRow;
}

export function isWhitelisted(phone: string): boolean {
  const row = getDB()
    .prepare('SELECT is_whitelisted FROM contacts WHERE phone = ?')
    .get(phone) as { is_whitelisted: number } | null;
  return row?.is_whitelisted === 1;
}

export function isBlacklisted(phone: string): boolean {
  const row = getDB()
    .prepare('SELECT is_blacklisted, last_spam_trigger FROM contacts WHERE phone = ?')
    .get(phone) as { is_blacklisted: number; last_spam_trigger: string | null } | null;

  if (!row || !row.is_blacklisted) return false;

  // Auto-expire 24hr blacklist
  if (row.last_spam_trigger) {
    const triggerTime = new Date(row.last_spam_trigger).getTime();
    if (Date.now() - triggerTime > 24 * 60 * 60 * 1000) {
      getDB()
        .prepare('UPDATE contacts SET is_blacklisted = 0, spam_trigger_count = 0 WHERE phone = ?')
        .run(phone);
      return false;
    }
  }
  return true;
}

export function recordSpamTrigger(phone: string): boolean {
  const row = getDB()
    .prepare('SELECT spam_trigger_count FROM contacts WHERE phone = ?')
    .get(phone) as { spam_trigger_count: number } | null;

  const count = (row?.spam_trigger_count ?? 0) + 1;
  const blacklist = count >= config.rateLimit.blacklistThreshold ? 1 : 0;

  getDB().prepare(
    `UPDATE contacts SET spam_trigger_count = ?, is_blacklisted = ?, last_spam_trigger = datetime('now')
     WHERE phone = ?`
  ).run(count, blacklist, phone);

  return blacklist === 1;
}

// --- Conversation helpers ---

export interface ConversationRow {
  id: number;
  contact_phone: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export function getActiveConversation(phone: string): ConversationRow | null {
  const windowHours = config.conversation.newWindowHours;
  return getDB().prepare(
    `SELECT * FROM conversations
     WHERE contact_phone = ? AND status IN ('new', 'active', 'qualified', 'paused')
       AND updated_at > datetime('now', ?)
     ORDER BY updated_at DESC LIMIT 1`
  ).get(phone, `-${windowHours} hours`) as ConversationRow | null;
}

export function createConversation(phone: string): ConversationRow {
  const result = getDB().prepare(
    `INSERT INTO conversations (contact_phone, status) VALUES (?, 'new')`
  ).run(phone);

  return getDB()
    .prepare('SELECT * FROM conversations WHERE id = ?')
    .get(result.lastInsertRowid) as ConversationRow;
}

export function updateConversationStatus(id: number, status: string): void {
  getDB().prepare(
    `UPDATE conversations SET status = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(status, id);
}

export function touchConversation(id: number): void {
  getDB().prepare(
    `UPDATE conversations SET updated_at = datetime('now') WHERE id = ?`
  ).run(id);
}

// --- Message helpers ---

export interface MessageRow {
  role: string;
  content: string;
}

export function getConversationHistory(conversationId: number, limit?: number): MessageRow[] {
  const max = limit ?? config.conversation.maxHistoryMessages;
  return getDB().prepare(
    `SELECT role, content FROM messages
     WHERE conversation_id = ?
     ORDER BY timestamp ASC
     LIMIT ?`
  ).all(conversationId, max) as MessageRow[];
}

export function saveMessage(
  conversationId: number,
  role: string,
  content: string,
  actionJson?: string
): void {
  getDB().prepare(
    `INSERT INTO messages (conversation_id, role, content, action_json) VALUES (?, ?, ?, ?)`
  ).run(conversationId, role, content, actionJson ?? null);
  touchConversation(conversationId);
}

// --- Cleanup ---

export function closeStaleConversations(): number {
  const staleMin = config.conversation.staleMinutes;
  const result = getDB().prepare(
    `UPDATE conversations SET status = 'closed'
     WHERE status IN ('new', 'active', 'qualified')
       AND updated_at < datetime('now', ?)`
  ).run(`-${staleMin} minutes`);
  return result.changes;
}
