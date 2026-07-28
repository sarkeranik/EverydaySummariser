"""
Lightweight idempotent schema migrations for the local SQLite database.

`Base.metadata.create_all()` creates missing *tables* but never alters existing
ones, so any column added to a model after a user's journal.db was created would
be silently absent and every query touching it would fail with "no such column".

Each step below is guarded so it can run against any database state. The highest
applied version is recorded in the existing user_settings table.
"""

from sqlalchemy import text

SCHEMA_VERSION_KEY = "schema_version"


# ─── Guards ─────────────────────────────────────────────────────────────────

def _table_exists(conn, table):
    row = conn.execute(
        text("SELECT name FROM sqlite_master WHERE type='table' AND name=:n"),
        {"n": table},
    ).fetchone()
    return row is not None


def _column_exists(conn, table, column):
    rows = conn.execute(text(f"PRAGMA table_info({table})")).fetchall()
    return any(r[1] == column for r in rows)


def _add_column(table, column, ddl):
    """Return a step that adds a column only if the table exists without it."""
    def step(conn):
        if _table_exists(conn, table) and not _column_exists(conn, table, column):
            conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}"))
    return step


def _exec(sql):
    def step(conn):
        conn.execute(text(sql))
    return step


def _backfill_audio_status(conn):
    """
    Existing audio rows predate the transcription pipeline. Mark them pending so
    the worker picks them up; it checks each file's webm header and marks the
    headerless timeslice chunks 'skipped' rather than feeding them to whisper.
    """
    if _table_exists(conn, "captured_audio"):
        conn.execute(text(
            "UPDATE captured_audio SET transcript_status='pending' "
            "WHERE transcript_status IS NULL OR transcript_status=''"
        ))


# ─── Ordered steps ──────────────────────────────────────────────────────────
# (version, description, step)

MIGRATIONS = [
    (1, "captured_text.content_hash",
     _add_column("captured_text", "content_hash", "TEXT")),
    (2, "captured_text.visit_count",
     _add_column("captured_text", "visit_count", "INTEGER DEFAULT 1")),
    (3, "index on captured_text(content_hash)",
     _exec("CREATE INDEX IF NOT EXISTS ix_captured_text_content_hash "
           "ON captured_text(content_hash)")),
    (4, "captured_audio.session_id",
     _add_column("captured_audio", "session_id", "TEXT")),
    (5, "captured_audio.seq",
     _add_column("captured_audio", "seq", "INTEGER DEFAULT 0")),
    (6, "captured_audio.transcript",
     _add_column("captured_audio", "transcript", "TEXT")),
    (7, "captured_audio.transcript_status",
     _add_column("captured_audio", "transcript_status", "TEXT DEFAULT 'pending'")),
    (8, "captured_audio.transcript_error",
     _add_column("captured_audio", "transcript_error", "TEXT")),
    (9, "captured_audio.duration_seconds",
     _add_column("captured_audio", "duration_seconds", "REAL DEFAULT 0")),
    (10, "backfill transcript_status on legacy audio rows",
     _backfill_audio_status),
    (11, "captured_text.visit_count backfill",
     _exec("UPDATE captured_text SET visit_count=1 WHERE visit_count IS NULL")),
    (12, "captured_text.url_norm",
     _add_column("captured_text", "url_norm", "TEXT")),
    (13, "index on captured_text(url_norm)",
     _exec("CREATE INDEX IF NOT EXISTS ix_captured_text_url_norm "
           "ON captured_text(url_norm)")),
    # These two were briefly created as external-content FTS tables, on which a
    # plain DELETE is invalid. They are rebuilt as standalone tables immediately
    # afterwards by create_fts_tables(); no captured data lives in them.
    (14, "rebuild highlights_fts as a standalone FTS table",
     _exec("DROP TABLE IF EXISTS highlights_fts")),
    (15, "rebuild captured_audio_fts as a standalone FTS table",
     _exec("DROP TABLE IF EXISTS captured_audio_fts")),
]


# ─── Runner ─────────────────────────────────────────────────────────────────

def _get_version(conn):
    if not _table_exists(conn, "user_settings"):
        return 0
    row = conn.execute(
        text("SELECT value FROM user_settings WHERE key=:k"),
        {"k": SCHEMA_VERSION_KEY},
    ).fetchone()
    if row and str(row[0]).isdigit():
        return int(row[0])
    return 0


def _set_version(conn, version):
    conn.execute(
        text("INSERT INTO user_settings(key, value) VALUES(:k, :v) "
             "ON CONFLICT(key) DO UPDATE SET value=excluded.value"),
        {"k": SCHEMA_VERSION_KEY, "v": str(version)},
    )


def run_migrations(engine):
    """Apply every migration newer than the recorded schema version."""
    with engine.connect() as conn:
        current = _get_version(conn)
        applied = []

        for version, description, step in MIGRATIONS:
            if version <= current:
                continue
            try:
                step(conn)
                _set_version(conn, version)
                conn.commit()
                applied.append(f"{version}: {description}")
            except Exception as e:
                conn.rollback()
                print(f"Migration {version} ({description}) failed: {e}")
                break

        if applied:
            print(f"Applied {len(applied)} migration(s):")
            for line in applied:
                print(f"  - {line}")
