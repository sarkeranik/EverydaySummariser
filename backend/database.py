import os
from sqlalchemy import (
    create_engine, Column, Integer, String, Text, DateTime, Float,
    ForeignKey, LargeBinary, UniqueConstraint, event, text
)
from sqlalchemy.orm import declarative_base, sessionmaker, relationship
from datetime import datetime

os.makedirs("data", exist_ok=True)
DATABASE_URL = "sqlite:///./data/journal.db"

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


# ─── Existing Tables (enhanced) ──────────────────────────────────────────────

class CapturedText(Base):
    __tablename__ = "captured_text"
    id = Column(Integer, primary_key=True, index=True)
    url = Column(String, index=True)
    title = Column(String)
    content = Column(Text)
    dwell_time_ms = Column(Integer, default=0)  # accumulated *visible* time in milliseconds
    extraction_method = Column(String, default="raw")  # readability, heuristic, raw, server
    content_hash = Column(String, index=True)  # sha256 of normalised content, for per-day dedup
    url_norm = Column(String, index=True)  # url minus fragment and tracking params
    visit_count = Column(Integer, default=1)  # revisits merge into one row per day
    timestamp = Column(DateTime, default=datetime.utcnow)

class CapturedImage(Base):
    __tablename__ = "captured_images"
    id = Column(Integer, primary_key=True, index=True)
    url = Column(String, index=True)
    image_url = Column(String)
    alt_text = Column(String)
    timestamp = Column(DateTime, default=datetime.utcnow)

class CapturedAudio(Base):
    __tablename__ = "captured_audio"
    id = Column(Integer, primary_key=True, index=True)
    url = Column(String, index=True)
    filename = Column(String)  # path to local audio file
    session_id = Column(String, index=True)  # groups rotations of one listening session
    seq = Column(Integer, default=0)  # rotation order within the session
    transcript = Column(Text)
    transcript_status = Column(String, default="pending")  # pending|running|done|failed|skipped
    transcript_error = Column(Text)
    duration_seconds = Column(Float, default=0)
    timestamp = Column(DateTime, default=datetime.utcnow)


# ─── New Capture Tables ──────────────────────────────────────────────────────

class CapturedYouTube(Base):
    __tablename__ = "captured_youtube"
    id = Column(Integer, primary_key=True, index=True)
    url = Column(String, index=True)
    video_id = Column(String, index=True)
    title = Column(String)
    channel = Column(String)
    transcript = Column(Text)
    duration_seconds = Column(Integer, default=0)
    timestamp = Column(DateTime, default=datetime.utcnow)

class CapturedPDF(Base):
    __tablename__ = "captured_pdf"
    id = Column(Integer, primary_key=True, index=True)
    url = Column(String, index=True)
    filename = Column(String)
    content = Column(Text)
    page_count = Column(Integer, default=0)
    timestamp = Column(DateTime, default=datetime.utcnow)

class CapturedTwitterThread(Base):
    __tablename__ = "captured_twitter"
    id = Column(Integer, primary_key=True, index=True)
    url = Column(String, index=True)
    author = Column(String)
    thread_text = Column(Text)
    tweet_count = Column(Integer, default=0)
    timestamp = Column(DateTime, default=datetime.utcnow)


# ─── Highlights (explicit user saves) ───────────────────────────────────────

class Highlight(Base):
    __tablename__ = "highlights"
    id = Column(Integer, primary_key=True, index=True)
    url = Column(String, index=True)
    title = Column(String, default="")
    selected_text = Column(Text)
    note = Column(Text, default="")  # optional user annotation
    timestamp = Column(DateTime, default=datetime.utcnow)


# ─── Daily / Weekly / Monthly Notes ─────────────────────────────────────────

class DailyNote(Base):
    __tablename__ = "daily_notes"
    id = Column(Integer, primary_key=True, index=True)
    date = Column(String, unique=True, index=True)  # YYYY-MM-DD or YYYY-WXX or YYYY-MM
    note_type = Column(String, default="daily")  # daily, weekly, monthly
    filepath = Column(String)
    content = Column(Text)
    generated_at = Column(DateTime, default=datetime.utcnow)


# ─── Tags System ─────────────────────────────────────────────────────────────

class Tag(Base):
    __tablename__ = "tags"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, nullable=False)
    color = Column(String, default="#7c3aed")  # hex color
    created_at = Column(DateTime, default=datetime.utcnow)
    pages = relationship("PageTag", back_populates="tag", cascade="all, delete-orphan")

class PageTag(Base):
    __tablename__ = "page_tags"
    id = Column(Integer, primary_key=True, index=True)
    page_url = Column(String, index=True, nullable=False)
    page_title = Column(String, default="")
    tag_id = Column(Integer, ForeignKey("tags.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    tag = relationship("Tag", back_populates="pages")


# ─── Semantic Index ──────────────────────────────────────────────────────────

class Embedding(Base):
    """
    One row per chunk of captured content. Vectors are stored as raw float32
    bytes: at this corpus size a brute-force numpy scan takes milliseconds, so a
    vector database (and its binary dependency) would buy nothing.
    """
    __tablename__ = "embeddings"
    __table_args__ = (
        UniqueConstraint("source_type", "source_id", "chunk_index", name="uq_embedding_chunk"),
    )

    id = Column(Integer, primary_key=True, index=True)
    source_type = Column(String, index=True)  # text|youtube|pdf|twitter|highlight|audio|note
    source_id = Column(Integer, index=True)
    chunk_index = Column(Integer, default=0)
    chunk_text = Column(Text)
    title = Column(String, default="")
    url = Column(String, default="")
    vector = Column(LargeBinary)
    dim = Column(Integer, default=0)
    source_timestamp = Column(DateTime)
    created_at = Column(DateTime, default=datetime.utcnow)


# ─── User Settings ───────────────────────────────────────────────────────────

class UserSettings(Base):
    __tablename__ = "user_settings"
    id = Column(Integer, primary_key=True, index=True)
    key = Column(String, unique=True, nullable=False, index=True)
    value = Column(Text, default="")


# ─── Create Tables ───────────────────────────────────────────────────────────
# Order matters: create_all adds new tables, then migrations alter pre-existing
# ones (create_all cannot), then the FTS virtual tables are ensured.

Base.metadata.create_all(bind=engine)

from migrations import run_migrations  # noqa: E402  (must follow create_all)

try:
    run_migrations(engine)
except Exception as e:
    print(f"Warning: migrations failed: {e}")


# ─── FTS5 Virtual Tables ────────────────────────────────────────────────────
# These are created manually since SQLAlchemy doesn't natively support FTS5

def create_fts_tables(engine):
    """Create FTS5 virtual tables for full-text search."""
    with engine.connect() as conn:
        # FTS for captured text
        conn.execute(text("""
            CREATE VIRTUAL TABLE IF NOT EXISTS captured_text_fts
            USING fts5(title, content, url, content='captured_text', content_rowid='id')
        """))
        # FTS for daily notes
        conn.execute(text("""
            CREATE VIRTUAL TABLE IF NOT EXISTS daily_notes_fts
            USING fts5(date, content, content='daily_notes', content_rowid='id')
        """))
        # FTS for YouTube transcripts
        conn.execute(text("""
            CREATE VIRTUAL TABLE IF NOT EXISTS captured_youtube_fts
            USING fts5(title, channel, transcript, content='captured_youtube', content_rowid='id')
        """))
        # FTS for PDFs
        conn.execute(text("""
            CREATE VIRTUAL TABLE IF NOT EXISTS captured_pdf_fts
            USING fts5(filename, content, content='captured_pdf', content_rowid='id')
        """))
        # FTS for Twitter threads
        conn.execute(text("""
            CREATE VIRTUAL TABLE IF NOT EXISTS captured_twitter_fts
            USING fts5(author, thread_text, content='captured_twitter', content_rowid='id')
        """))
        # Highlights and transcripts are indexed as ordinary (non external-content)
        # FTS5 tables: rows here are deleted and re-inserted when a highlight is
        # removed or a recording is re-transcribed, and plain DELETE is only valid
        # on a standalone FTS table.
        conn.execute(text("""
            CREATE VIRTUAL TABLE IF NOT EXISTS highlights_fts
            USING fts5(title, selected_text, note)
        """))
        conn.execute(text("""
            CREATE VIRTUAL TABLE IF NOT EXISTS captured_audio_fts
            USING fts5(url, transcript)
        """))
        conn.commit()

# Create FTS tables on import
try:
    create_fts_tables(engine)
except Exception as e:
    print(f"Warning: Could not create FTS tables: {e}")
