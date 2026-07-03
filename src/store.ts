import Database from 'better-sqlite3';
import { ulid } from 'ulid';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  Memory,
  MemoryRef,
  MemoryType,
  NewMemory,
  RecallOptions,
  Severity,
  Status,
} from './types.js';
import { redactSecrets } from './redact.js';
import { gitContext, hashFile, normalizeRepoPath } from './git.js';

export const PM_DIR = '.memini';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info',
  confidence TEXT NOT NULL DEFAULT 'unverified',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT NOT NULL DEFAULT 'unknown',
  source_session TEXT
);
CREATE TABLE IF NOT EXISTS memory_refs (
  memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  ref_type TEXT NOT NULL,
  ref_value TEXT NOT NULL,
  file_content_hash TEXT
);
CREATE INDEX IF NOT EXISTS idx_refs_value ON memory_refs(ref_value);
CREATE INDEX IF NOT EXISTS idx_refs_memory ON memory_refs(memory_id);
CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
  title, body, content='memories', content_rowid='rowid'
);
CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, title, body) VALUES (new.rowid, new.title, new.body);
END;
CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, title, body) VALUES ('delete', old.rowid, old.title, old.body);
END;
CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, title, body) VALUES ('delete', old.rowid, old.title, old.body);
  INSERT INTO memories_fts(rowid, title, body) VALUES (new.rowid, new.title, new.body);
END;
-- session-scoped "already warned" tracking for warn-once guardrail semantics
CREATE TABLE IF NOT EXISTS session_warnings (
  session_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  warned_at TEXT NOT NULL,
  PRIMARY KEY (session_id, file_path)
);
`;

interface MemoryRow {
  id: string;
  type: MemoryType;
  title: string;
  body: string;
  severity: Severity;
  confidence: Memory['confidence'];
  status: Status;
  created_at: string;
  updated_at: string;
  created_by: string;
  source_session: string | null;
}

export class MemoryStore {
  readonly db: Database.Database;
  readonly root: string;
  readonly dir: string;

  constructor(root: string) {
    this.root = root;
    this.dir = join(root, PM_DIR);
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
    this.db = new Database(join(this.dir, 'memory.db'));
    this.db.pragma('journal_mode = WAL');
    this.db.exec(SCHEMA);
  }

  static exists(root: string): boolean {
    return existsSync(join(root, PM_DIR, 'memory.db'));
  }

  close(): void {
    this.db.close();
  }

  add(input: NewMemory): Memory {
    const now = new Date().toISOString();
    const id = ulid();
    const { text: body } = redactSecrets(input.body);
    const { text: title } = redactSecrets(input.title);
    const ctx = gitContext(this.root);
    const createdBy = input.createdBy ?? (ctx.user ? `human:${ctx.user}` : 'unknown');

    const insert = this.db.prepare(`
      INSERT INTO memories (id, type, title, body, severity, confidence, status, created_at, updated_at, created_by, source_session)
      VALUES (@id, @type, @title, @body, @severity, @confidence, 'active', @now, @now, @createdBy, @sourceSession)
    `);
    const insertRef = this.db.prepare(`
      INSERT INTO memory_refs (memory_id, ref_type, ref_value, file_content_hash)
      VALUES (?, ?, ?, ?)
    `);

    this.db.transaction(() => {
      insert.run({
        id,
        type: input.type,
        title,
        body,
        severity: input.severity ?? 'info',
        confidence: input.confidence ?? 'unverified',
        now,
        createdBy,
        sourceSession: input.sourceSession ?? null,
      });
      for (const f of input.files ?? []) {
        const rel = normalizeRepoPath(this.root, f);
        insertRef.run(id, 'file', rel, hashFile(this.root, rel));
      }
      if (ctx.head) insertRef.run(id, 'commit', ctx.head, null);
      if (ctx.branch && ctx.branch !== 'HEAD') insertRef.run(id, 'branch', ctx.branch, null);
    })();

    return this.get(id)!;
  }

  get(id: string): Memory | null {
    const row = this.db
      .prepare(`SELECT * FROM memories WHERE id = ? OR id LIKE ? || '%'`)
      .get(id, id) as MemoryRow | undefined;
    if (!row) return null;
    return this.hydrate(row);
  }

  private hydrate(row: MemoryRow): Memory {
    const refs = (
      this.db.prepare(`SELECT ref_type, ref_value, file_content_hash FROM memory_refs WHERE memory_id = ?`).all(row.id) as {
        ref_type: MemoryRef['refType'];
        ref_value: string;
        file_content_hash: string | null;
      }[]
    ).map((r) => ({ refType: r.ref_type, refValue: r.ref_value, fileContentHash: r.file_content_hash }));
    return {
      id: row.id,
      type: row.type,
      title: row.title,
      body: row.body,
      severity: row.severity,
      confidence: row.confidence,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      createdBy: row.created_by,
      sourceSession: row.source_session,
      refs,
    };
  }

  setStatus(id: string, status: Status): Memory | null {
    const mem = this.get(id);
    if (!mem) return null;
    this.db
      .prepare(`UPDATE memories SET status = ?, updated_at = ? WHERE id = ?`)
      .run(status, new Date().toISOString(), mem.id);
    return this.get(mem.id);
  }

  setConfidence(id: string, confidence: Memory['confidence']): Memory | null {
    const mem = this.get(id);
    if (!mem) return null;
    this.db
      .prepare(`UPDATE memories SET confidence = ?, updated_at = ? WHERE id = ?`)
      .run(confidence, new Date().toISOString(), mem.id);
    return this.get(mem.id);
  }

  list(opts: { type?: MemoryType; status?: Status } = {}): Memory[] {
    const conds: string[] = [];
    const params: string[] = [];
    if (opts.type) {
      conds.push('type = ?');
      params.push(opts.type);
    }
    if (opts.status) {
      conds.push('status = ?');
      params.push(opts.status);
    }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const rows = this.db
      .prepare(`SELECT * FROM memories ${where} ORDER BY created_at DESC`)
      .all(...params) as MemoryRow[];
    return rows.map((r) => this.hydrate(r));
  }

  /** Search + filter. Severity-first, newest-first ordering. */
  recall(opts: RecallOptions = {}): Memory[] {
    const limit = opts.limit ?? 20;
    let ids: string[] | null = null;

    if (opts.query) {
      const ftsQuery = opts.query
        .replace(/['"*^]/g, ' ')
        .split(/\s+/)
        .filter(Boolean)
        .map((t) => `"${t}"`)
        .join(' OR ');
      if (ftsQuery) {
        const rows = this.db
          .prepare(
            `SELECT m.id FROM memories_fts f JOIN memories m ON m.rowid = f.rowid
             WHERE memories_fts MATCH ? ORDER BY rank LIMIT 200`
          )
          .all(ftsQuery) as { id: string }[];
        ids = rows.map((r) => r.id);
        if (ids.length === 0) return [];
      }
    }

    let fileIds: string[] | null = null;
    if (opts.file) {
      const rel = normalizeRepoPath(this.root, opts.file);
      const rows = this.db
        .prepare(`SELECT DISTINCT memory_id FROM memory_refs WHERE ref_type = 'file' AND ref_value = ?`)
        .all(rel) as { memory_id: string }[];
      fileIds = rows.map((r) => r.memory_id);
      if (fileIds.length === 0) return [];
    }

    const statuses = opts.includeStale ? ['active', 'stale'] : ['active'];
    let memories = this.list()
      .filter((m) => statuses.includes(m.status))
      .filter((m) => (opts.type ? m.type === opts.type : true))
      .filter((m) => (ids ? ids.includes(m.id) : true))
      .filter((m) => (fileIds ? fileIds.includes(m.id) : true));

    const sevRank: Record<Severity, number> = { block: 0, warn: 1, info: 2 };
    memories.sort((a, b) => sevRank[a.severity] - sevRank[b.severity] || b.createdAt.localeCompare(a.createdAt));
    return memories.slice(0, limit);
  }

  /** Guardrail primitive: active warn/block memories referencing this file. Stale memories don't fire. */
  check(filePath: string): Memory[] {
    const rel = normalizeRepoPath(this.root, filePath);
    const rows = this.db
      .prepare(
        `SELECT DISTINCT m.* FROM memories m
         JOIN memory_refs r ON r.memory_id = m.id
         WHERE r.ref_type = 'file' AND r.ref_value = ?
           AND m.status = 'active' AND m.severity IN ('warn','block')
         ORDER BY CASE m.severity WHEN 'block' THEN 0 ELSE 1 END, m.created_at DESC`
      )
      .all(rel) as MemoryRow[];
    return rows.map((r) => this.hydrate(r));
  }

  /** Re-hash referenced files; mark memories stale when referenced content changed or disappeared. */
  detectStale(): { memory: Memory; changedFiles: string[] }[] {
    const results: { memory: Memory; changedFiles: string[] }[] = [];
    for (const mem of this.list({ status: 'active' })) {
      const changed: string[] = [];
      for (const ref of mem.refs) {
        if (ref.refType !== 'file' || !ref.fileContentHash) continue;
        const current = hashFile(this.root, ref.refValue);
        if (current !== ref.fileContentHash) changed.push(ref.refValue);
      }
      if (changed.length > 0) {
        this.setStatus(mem.id, 'stale');
        results.push({ memory: this.get(mem.id)!, changedFiles: changed });
      }
    }
    return results;
  }

  /** Re-verify a stale memory: mark active again and refresh file hashes to current content. */
  reverify(id: string): Memory | null {
    const mem = this.get(id);
    if (!mem) return null;
    const update = this.db.prepare(
      `UPDATE memory_refs SET file_content_hash = ? WHERE memory_id = ? AND ref_type = 'file' AND ref_value = ?`
    );
    for (const ref of mem.refs) {
      if (ref.refType === 'file') update.run(hashFile(this.root, ref.refValue), mem.id, ref.refValue);
    }
    this.db
      .prepare(`UPDATE memories SET status = 'active', confidence = 'human_verified', updated_at = ? WHERE id = ?`)
      .run(new Date().toISOString(), mem.id);
    return this.get(mem.id);
  }

  // --- warn-once tracking (guardrail UX: warn blocks first attempt, allows retry) ---

  hasWarned(sessionId: string, filePath: string): boolean {
    const rel = normalizeRepoPath(this.root, filePath);
    return !!this.db
      .prepare(`SELECT 1 FROM session_warnings WHERE session_id = ? AND file_path = ?`)
      .get(sessionId, rel);
  }

  markWarned(sessionId: string, filePath: string): void {
    const rel = normalizeRepoPath(this.root, filePath);
    this.db
      .prepare(
        `INSERT OR REPLACE INTO session_warnings (session_id, file_path, warned_at) VALUES (?, ?, ?)`
      )
      .run(sessionId, rel, new Date().toISOString());
  }
}
