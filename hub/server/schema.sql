CREATE TABLE IF NOT EXISTS titles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  progress INTEGER NOT NULL DEFAULT 0,
  total_episodes INTEGER,
  shield_on INTEGER NOT NULL DEFAULT 1,
  memory_status TEXT NOT NULL DEFAULT 'none',
  bible_json TEXT,
  bible_version INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

-- 판정은 진행도와 엄격도에 독립적이므로 두 값은 키에 넣지 않는다
CREATE TABLE IF NOT EXISTS verdicts (
  text_hash TEXT NOT NULL,
  title_id TEXT NOT NULL,
  bible_version INTEGER NOT NULL,
  model TEXT NOT NULL,
  title_match INTEGER NOT NULL,
  reveals_ordinal INTEGER,
  level INTEGER NOT NULL,
  reason TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (text_hash, title_id, bible_version, model)
);

CREATE TABLE IF NOT EXISTS overrides (
  text_hash TEXT NOT NULL,
  title_id TEXT NOT NULL,
  label TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (text_hash, title_id)
);

-- 원문은 저장하지 않는다
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  host TEXT NOT NULL,
  title_id TEXT,
  decision TEXT NOT NULL,
  reason TEXT,
  cached INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER
);

CREATE TABLE IF NOT EXISTS llm_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  purpose TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL,
  cached_input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL,
  items INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
