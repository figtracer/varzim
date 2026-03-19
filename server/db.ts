import { Database } from 'bun:sqlite'

const DB_PATH = process.env.DB_PATH || './varzim.db'

let db: Database

export function getDb(): Database {
  if (!db) {
    db = new Database(DB_PATH)
    db.exec('PRAGMA journal_mode = WAL')
    db.exec(`
      CREATE TABLE IF NOT EXISTS queries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        contract_address TEXT NOT NULL,
        event_signature TEXT NOT NULL,
        from_block INTEGER NOT NULL,
        to_block INTEGER NOT NULL,
        result_count INTEGER NOT NULL,
        payer_address TEXT NOT NULL,
        tx_hash TEXT NOT NULL,
        cost_usd TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS cached_abis (
        address TEXT PRIMARY KEY,
        abi_json TEXT NOT NULL,
        name TEXT,
        fetched_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_queries_payer ON queries(payer_address);
      CREATE INDEX IF NOT EXISTS idx_queries_contract ON queries(contract_address);

      CREATE TABLE IF NOT EXISTS watch_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        watch_id TEXT NOT NULL,
        block_number INTEGER NOT NULL,
        tx_hash TEXT NOT NULL,
        log_index INTEGER NOT NULL,
        args_json TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_watch_events_watch ON watch_events(watch_id);
    `)
  }
  return db
}
