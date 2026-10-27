CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS race_environment (date TEXT NOT NULL, venue_code TEXT NOT NULL, race_no INTEGER NOT NULL, fetched_at TEXT NOT NULL, source_url TEXT NOT NULL, wind_direction_code INTEGER, wind_speed_mps REAL, wave_height_cm REAL, tide_height_cm REAL, tide_station TEXT, tide_kind TEXT, payload TEXT NOT NULL, PRIMARY KEY(date,venue_code,race_no,fetched_at));
CREATE INDEX IF NOT EXISTS race_environment_date ON race_environment(date);
CREATE TABLE IF NOT EXISTS verification_records (kind TEXT NOT NULL, race_key TEXT NOT NULL, date TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(kind,race_key));
CREATE INDEX IF NOT EXISTS verification_date ON verification_records(date);
