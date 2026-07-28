"""
Local transcription of captured tab audio using faster-whisper.

Audio is the most sensitive thing the extension captures, so it is transcribed
on this machine regardless of which AI_PROVIDER is configured for summarisation.

Work is queued in the database rather than run inline: whisper is CPU-heavy and
uploads arrive while the user is browsing. A single row is processed per tick, so
several tabs going silent at once cannot start parallel transcriptions.
"""

import os
from datetime import datetime

from sqlalchemy import text, func

from database import SessionLocal, CapturedAudio, UserSettings

# MediaRecorder only writes the EBML header into the first blob of a stream.
# Files without it are the tail chunks of the old timesliced recorder and cannot
# be decoded at all — they are skipped rather than retried forever.
WEBM_MAGIC = b"\x1a\x45\xdf\xa3"

_model = None
_model_key = None
_device = None  # resolved once a device is known to actually work

# A GPU can be present while its CUDA libraries are not installed, in which case
# device="auto" selects it and inference dies on the first call.
GPU_ERROR_HINTS = ("cublas", "cudnn", "cuda", "libcu", "gpu")


def _get_setting(db, key, default):
    row = db.query(UserSettings).filter(UserSettings.key == key).first()
    return row.value if row and row.value else default


def _looks_like_gpu_error(err) -> bool:
    message = str(err).lower()
    return any(hint in message for hint in GPU_ERROR_HINTS)


def _load_model(name, device):
    """Load (and cache) the whisper model. First call downloads the weights."""
    global _model, _model_key

    key = (name, device)
    if _model is not None and _model_key == key:
        return _model

    from faster_whisper import WhisperModel

    print(f"Loading whisper model '{name}' on {device} (first run downloads weights)...")
    _model = WhisperModel(name, device=device, compute_type="int8")
    _model_key = key
    return _model


def _run_transcription(name, device, path):
    """Transcribe fully here: segments is lazy, so errors surface on consumption."""
    model = _load_model(name, device)
    segments, info = model.transcribe(path, vad_filter=True)
    transcript = " ".join(s.text.strip() for s in segments).strip()
    return transcript, info


def transcribe_file(name, preferred_device, path):
    """Transcribe, falling back to CPU once if the GPU path is unusable."""
    global _device, _model, _model_key

    device = _device or preferred_device
    try:
        return _run_transcription(name, device, path)
    except Exception as e:
        if device != "cpu" and _looks_like_gpu_error(e):
            print(f"GPU transcription unavailable ({e}). Falling back to CPU.")
            _device = "cpu"
            _model, _model_key = None, None
            return _run_transcription(name, "cpu", path)
        raise


def has_webm_header(path: str) -> bool:
    try:
        with open(path, "rb") as f:
            return f.read(4) == WEBM_MAGIC
    except OSError:
        return False


def _index_transcript(db, row_id: int, url: str, transcript: str):
    try:
        db.execute(text("DELETE FROM captured_audio_fts WHERE rowid = :rid"), {"rid": row_id})
        db.execute(
            text("INSERT INTO captured_audio_fts(rowid, url, transcript) "
                 "VALUES (:rid, :url, :transcript)"),
            {"rid": row_id, "url": url, "transcript": transcript},
        )
        db.commit()
    except Exception as e:
        print(f"Transcript FTS index warning: {e}")


def _transcribe_row(db, row):
    if not row.filename or not os.path.exists(row.filename):
        row.transcript_status = "failed"
        row.transcript_error = "audio file missing"
        db.commit()
        return

    if not has_webm_header(row.filename):
        row.transcript_status = "skipped"
        row.transcript_error = "headerless chunk from the legacy timesliced recorder"
        db.commit()
        return

    row.transcript_status = "running"
    db.commit()

    try:
        name = _get_setting(db, "whisper_model", "base")
        preferred_device = _get_setting(db, "whisper_device", "auto")
        transcript, info = transcribe_file(name, preferred_device, row.filename)

        row.transcript = transcript
        row.duration_seconds = getattr(info, "duration", 0) or 0
        row.transcript_status = "done"
        row.transcript_error = None
        db.commit()

        if transcript:
            _index_transcript(db, row.id, row.url, transcript)

    except Exception as e:
        row.transcript_status = "failed"
        row.transcript_error = str(e)[:500]
        db.commit()
        print(f"Transcription failed for {row.filename}: {e}")


def transcribe_pending(limit: int = 1):
    """Process up to `limit` queued recordings. Called on a timer, and on demand."""
    db = SessionLocal()
    try:
        rows = (
            db.query(CapturedAudio)
            .filter(CapturedAudio.transcript_status == "pending")
            .order_by(CapturedAudio.id)
            .limit(limit)
            .all()
        )
        for row in rows:
            _transcribe_row(db, row)
        return len(rows)
    finally:
        db.close()


def reset_stuck_running():
    """
    A process restart (uvicorn --reload) leaves rows marked 'running' that no
    longer have a worker. Requeue them at startup so the work isn't lost.
    """
    db = SessionLocal()
    try:
        count = (
            db.query(CapturedAudio)
            .filter(CapturedAudio.transcript_status == "running")
            .update({"transcript_status": "pending"}, synchronize_session=False)
        )
        db.commit()
        if count:
            print(f"Requeued {count} interrupted transcription(s).")
    finally:
        db.close()


def queue_stats():
    db = SessionLocal()
    try:
        rows = (
            db.query(CapturedAudio.transcript_status, func.count(CapturedAudio.id))
            .group_by(CapturedAudio.transcript_status)
            .all()
        )
        return {status or "unknown": count for status, count in rows}
    finally:
        db.close()
