// Coach durable memory — pgvector on the boost Postgres (boost_resume_n_packet_builder).
// Ported from the huddle RAG store, simplified for boost: a single owner-scoped
// memory store using text-embedding-3-small (1536 dims, so no halfvec needed —
// pgvector's ivfflat/hnsw handle <=2000 dims natively), plus a lightweight
// knowledge-graph triples table. Connects via the same AZURE_PG_* / DATABASE_URL
// settings the rest of the API uses. Errors are never swallowed.

import { Pool } from 'pg'

export const EMBED_MODEL = 'text-embedding-3-small'
export const EMBED_DIM = 1536

let _pool: Pool | null = null

function connString(): string | undefined {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  const host = process.env.AZURE_PG_HOST
  const db = process.env.AZURE_PG_DATABASE || 'boost_resume_n_packet_builder'
  const user = process.env.AZURE_PG_USER
  const pw = process.env.AZURE_PG_PASSWORD
  const port = process.env.AZURE_PG_PORT || '5432'
  if (!host || !user || !pw) return undefined
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(pw)}@${host}:${port}/${db}?sslmode=require`
}

export function getPool(): Pool {
  if (_pool) return _pool
  const cs = connString()
  if (!cs) throw new Error('Postgres not configured (need DATABASE_URL or AZURE_PG_HOST/USER/PASSWORD)')
  _pool = new Pool({ connectionString: cs, ssl: { rejectUnauthorized: false }, max: 3, idleTimeoutMillis: 20_000, connectionTimeoutMillis: 10_000 })
  return _pool
}

export const BOOTSTRAP_SQL = `
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS coach_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner TEXT NOT NULL DEFAULT 'shared',
  kind TEXT NOT NULL DEFAULT 'note',           -- note | fact | conversation | file
  text TEXT NOT NULL,
  source TEXT,
  embedding vector(${EMBED_DIM}) NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS coach_memory_owner_idx ON coach_memory (owner);
CREATE INDEX IF NOT EXISTS coach_memory_embed_hnsw
  ON coach_memory USING hnsw (embedding vector_cosine_ops);

CREATE TABLE IF NOT EXISTS coach_triples (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner TEXT NOT NULL DEFAULT 'shared',
  subject TEXT NOT NULL,
  predicate TEXT NOT NULL,
  object TEXT NOT NULL,
  confidence REAL DEFAULT 0.8,
  source_id UUID REFERENCES coach_memory(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS coach_triples_owner_idx ON coach_triples (owner);
CREATE INDEX IF NOT EXISTS coach_triples_subject_idx ON coach_triples (subject);
CREATE INDEX IF NOT EXISTS coach_triples_fts_idx
  ON coach_triples USING gin (to_tsvector('english', subject || ' ' || predicate || ' ' || object));
`

export async function bootstrapMemory(): Promise<{ ok: boolean; tables: string[]; error?: string }> {
  try {
    const pool = getPool()
    await pool.query(BOOTSTRAP_SQL)
    const t = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('coach_memory','coach_triples')`)
    return { ok: true, tables: t.rows.map((r) => r.table_name) }
  } catch (err) {
    return { ok: false, tables: [], error: err instanceof Error ? err.message : String(err) }
  }
}

function toPgVector(v: number[]): string { return `[${v.join(',')}]` }

export async function embed(text: string): Promise<number[]> {
  const key = process.env.OPENAI_API_KEY
  if (!key) throw new Error('OPENAI_API_KEY not configured')
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: EMBED_MODEL, input: text.slice(0, 8000) }),
  })
  if (!res.ok) throw new Error(`Embeddings HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return (await res.json() as any).data[0].embedding as number[]
}

// Ensure schema exists, then write a memory row. Idempotent bootstrap keeps the
// first call after a fresh DB from failing.
export async function remember(input: { owner?: string; kind?: string; text: string; source?: string; metadata?: any }): Promise<{ id: string }> {
  const pool = getPool()
  await pool.query(BOOTSTRAP_SQL).catch(() => undefined)
  const vec = await embed(input.text)
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO coach_memory (owner, kind, text, source, embedding, metadata)
     VALUES ($1,$2,$3,$4,$5::vector,$6) RETURNING id`,
    [input.owner || 'shared', input.kind || 'note', input.text, input.source || null, toPgVector(vec), input.metadata || {}])
  return { id: rows[0].id }
}

export interface RecallHit { id: string; text: string; source: string | null; kind: string; score: number; createdAt: string }

// Semantic recall: owner's rows + shared rows, ordered by cosine similarity.
export async function recall(input: { owner?: string; query: string; k?: number }): Promise<RecallHit[]> {
  const pool = getPool()
  const vec = await embed(input.query)
  const k = Math.min(Math.max(input.k ?? 6, 1), 20)
  const { rows } = await pool.query(
    `SELECT id, text, source, kind, created_at,
            1 - (embedding <=> $1::vector) AS score
     FROM coach_memory
     WHERE owner = $2 OR owner = 'shared'
     ORDER BY embedding <=> $1::vector
     LIMIT $3`,
    [toPgVector(vec), input.owner || 'shared', k])
  return rows.map((r: any) => ({ id: r.id, text: r.text, source: r.source, kind: r.kind, score: Number(r.score), createdAt: r.created_at }))
}

export async function listMemory(input: { owner?: string; limit?: number }): Promise<RecallHit[]> {
  const pool = getPool()
  await pool.query(BOOTSTRAP_SQL).catch(() => undefined)
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200)
  const { rows } = await pool.query(
    `SELECT id, text, source, kind, created_at, 1 AS score FROM coach_memory
     WHERE owner = $1 OR owner = 'shared' ORDER BY created_at DESC LIMIT $2`,
    [input.owner || 'shared', limit])
  return rows.map((r: any) => ({ id: r.id, text: r.text, source: r.source, kind: r.kind, score: 1, createdAt: r.created_at }))
}

export async function deleteMemory(id: string): Promise<{ deleted: number }> {
  const { rows } = await getPool().query<{ id: string }>(`DELETE FROM coach_memory WHERE id=$1 RETURNING id`, [id])
  return { deleted: rows.length }
}
