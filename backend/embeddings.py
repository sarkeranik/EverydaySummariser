"""
Semantic index over everything captured.

FTS5 already handles "find the page containing this exact word". This module
handles "what was that article about Postgres locking I read in May?", where the
user remembers the idea but not the wording.

Embeddings are produced locally by fastembed (ONNX runtime, no torch) so semantic
search works identically whichever AI_PROVIDER is configured. Vectors are stored
as raw float32 bytes and scanned with numpy: at this corpus size that is a
sub-millisecond dot product, and a vector database would add a dependency
without adding speed.
"""

import numpy as np
from datetime import datetime

from database import (
    SessionLocal, Embedding,
    CapturedText, CapturedYouTube, CapturedPDF, CapturedTwitterThread,
    CapturedAudio, Highlight, DailyNote,
)

CHUNK_SIZE = 1200
CHUNK_OVERLAP = 150
DEFAULT_MODEL = "BAAI/bge-small-en-v1.5"

_model = None
_model_name = None


# ─── Sources ────────────────────────────────────────────────────────────────
# (source_type, model, text builder, title builder, url builder)

SOURCES = [
    ("text", CapturedText,
     lambda r: f"{r.title or ''}\n{r.content or ''}",
     lambda r: r.title or "", lambda r: r.url or ""),
    ("youtube", CapturedYouTube,
     lambda r: f"{r.title or ''} by {r.channel or ''}\n{r.transcript or ''}",
     lambda r: r.title or "", lambda r: r.url or ""),
    ("pdf", CapturedPDF,
     lambda r: f"{r.filename or ''}\n{r.content or ''}",
     lambda r: r.filename or "", lambda r: r.url or ""),
    ("twitter", CapturedTwitterThread,
     lambda r: f"Thread by @{r.author or ''}\n{r.thread_text or ''}",
     lambda r: f"@{r.author or ''}", lambda r: r.url or ""),
    ("highlight", Highlight,
     lambda r: f"{r.selected_text or ''}\n{r.note or ''}",
     lambda r: r.title or "", lambda r: r.url or ""),
    ("audio", CapturedAudio,
     lambda r: r.transcript or "",
     lambda r: "Audio", lambda r: r.url or ""),
    ("note", DailyNote,
     lambda r: r.content or "",
     lambda r: f"Journal {r.date}", lambda r: ""),
]

SOURCE_MODELS = {name: model for name, model, *_ in SOURCES}


def _get_setting(db, key, default):
    from database import UserSettings
    row = db.query(UserSettings).filter(UserSettings.key == key).first()
    return row.value if row and row.value else default


def _model_cache_dir():
    """
    Share one model cache with faster-whisper instead of letting fastembed keep a
    second copy in its own directory.
    """
    try:
        from huggingface_hub.constants import HF_HUB_CACHE
        return HF_HUB_CACHE
    except Exception:
        return None


def _prefetch_model_files(name, attempts):
    """
    Download the model files up front.

    The HF CDN intermittently resets fastembed's parallel fetches, so a first run
    can fail purely by luck. Retrying is cheap because whatever already arrived
    stays cached, and doing it here means a failure reports as a download problem
    rather than a confusing model-construction error.
    """
    from fastembed import TextEmbedding
    from huggingface_hub import snapshot_download

    repo = None
    for entry in TextEmbedding.list_supported_models():
        if entry.get("model") == name:
            repo = (entry.get("sources") or {}).get("hf")
            break
    if not repo:
        return

    cache_dir = _model_cache_dir()
    last_error = None
    for attempt in range(1, attempts + 1):
        try:
            snapshot_download(repo, cache_dir=cache_dir)
            return
        except Exception as e:
            last_error = e
            print(f"  model download attempt {attempt}/{attempts} failed: {type(e).__name__}")

    raise RuntimeError(f"Could not download embedding model '{name}': {last_error}")


def get_model(name=DEFAULT_MODEL, attempts=4):
    """Load and cache the embedding model. The first call downloads ~70 MB."""
    global _model, _model_name
    if _model is not None and _model_name == name:
        return _model

    from fastembed import TextEmbedding

    print(f"Loading embedding model '{name}' (first run downloads weights)...")
    _prefetch_model_files(name, attempts)

    _model = TextEmbedding(model_name=name, cache_dir=_model_cache_dir())
    _model_name = name
    return _model


def embed_texts(texts, model_name=DEFAULT_MODEL):
    model = get_model(model_name)
    return [np.asarray(v, dtype=np.float32) for v in model.embed(list(texts))]


def chunk_text(text):
    """Split into overlapping windows, preferring a sentence boundary near the end."""
    text = " ".join((text or "").split())
    if not text:
        return []
    if len(text) <= CHUNK_SIZE:
        return [text]

    chunks, start = [], 0
    while start < len(text):
        end = min(start + CHUNK_SIZE, len(text))
        if end < len(text):
            boundary = text.rfind(". ", start + CHUNK_SIZE // 2, end)
            if boundary != -1:
                end = boundary + 1
        chunks.append(text[start:end].strip())
        if end >= len(text):
            break
        start = max(end - CHUNK_OVERLAP, start + 1)

    return [c for c in chunks if c]


# ─── Indexing ───────────────────────────────────────────────────────────────

def _indexed_ids(db, source_type):
    rows = db.query(Embedding.source_id).filter(Embedding.source_type == source_type).distinct().all()
    return {r[0] for r in rows}


def index_pending(limit=25):
    """Embed source rows that have no vectors yet. Returns the number indexed."""
    db = SessionLocal()
    indexed = 0
    try:
        model_name = _get_setting(db, "embedding_model", DEFAULT_MODEL)

        for source_type, model, get_text, get_title, get_url in SOURCES:
            if indexed >= limit:
                break

            done = _indexed_ids(db, source_type)
            query = db.query(model).order_by(model.id.desc())
            candidates = [r for r in query.limit(500).all() if r.id not in done]
            if not candidates:
                continue

            for row in candidates:
                if indexed >= limit:
                    break

                chunks = chunk_text(get_text(row))
                if not chunks:
                    # Nothing embeddable (e.g. audio still awaiting transcription).
                    continue

                try:
                    vectors = embed_texts(chunks, model_name)
                except Exception as e:
                    print(f"Embedding failed for {source_type}:{row.id}: {e}")
                    return indexed

                timestamp = getattr(row, "timestamp", None) or getattr(row, "generated_at", None)
                for i, (chunk, vector) in enumerate(zip(chunks, vectors)):
                    db.add(Embedding(
                        source_type=source_type,
                        source_id=row.id,
                        chunk_index=i,
                        chunk_text=chunk,
                        title=get_title(row)[:300],
                        url=get_url(row)[:1000],
                        vector=vector.tobytes(),
                        dim=len(vector),
                        source_timestamp=timestamp,
                    ))
                db.commit()
                indexed += 1

        return indexed
    finally:
        db.close()


# ─── Retrieval ──────────────────────────────────────────────────────────────

def search(query, top_k=8, source_types=None):
    """Return the chunks most semantically similar to the query."""
    db = SessionLocal()
    try:
        model_name = _get_setting(db, "embedding_model", DEFAULT_MODEL)

        q = db.query(Embedding)
        if source_types:
            q = q.filter(Embedding.source_type.in_(source_types))
        rows = q.all()
        if not rows:
            return []

        matrix = np.vstack([np.frombuffer(r.vector, dtype=np.float32) for r in rows])
        query_vector = embed_texts([query], model_name)[0]

        # bge vectors are not unit-length by default, so normalise both sides.
        matrix /= (np.linalg.norm(matrix, axis=1, keepdims=True) + 1e-9)
        query_vector = query_vector / (np.linalg.norm(query_vector) + 1e-9)

        scores = matrix @ query_vector
        top = np.argsort(-scores)[:top_k]

        return [{
            "score": float(scores[i]),
            "source_type": rows[i].source_type,
            "source_id": rows[i].source_id,
            "title": rows[i].title,
            "url": rows[i].url,
            "chunk_text": rows[i].chunk_text,
            "timestamp": rows[i].source_timestamp.isoformat() if rows[i].source_timestamp else None,
        } for i in top]
    finally:
        db.close()


def index_stats():
    db = SessionLocal()
    try:
        from sqlalchemy import func
        rows = (
            db.query(Embedding.source_type, func.count(Embedding.id))
            .group_by(Embedding.source_type)
            .all()
        )
        return {
            "chunks_by_type": {t: c for t, c in rows},
            "total_chunks": sum(c for _, c in rows),
        }
    finally:
        db.close()
