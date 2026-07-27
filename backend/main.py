import os
import json
import glob
import requests
from datetime import datetime, date, timedelta
from fastapi import FastAPI, Depends, UploadFile, File, Form, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import func, cast, Date, text, desc
from pydantic import BaseModel
from typing import List, Optional
from dotenv import load_dotenv

load_dotenv()

from database import (
    SessionLocal, engine,
    CapturedText, CapturedImage, CapturedAudio,
    CapturedYouTube, CapturedPDF, CapturedTwitterThread,
    DailyNote, Tag, PageTag, UserSettings
)

app = FastAPI(title="Everyday Summariser API", version="2.0.0")

# Allow CORS from the Chrome extension
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Ensure folders exist
os.makedirs("audio_uploads", exist_ok=True)
os.makedirs("daily_notes", exist_ok=True)


# ─── Dependency ──────────────────────────────────────────────────────────────

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ─── Pydantic Models ─────────────────────────────────────────────────────────

class TextRequest(BaseModel):
    url: str
    title: str
    content: str
    dwell_time_ms: int = 0
    extraction_method: str = "raw"
    raw_html: Optional[str] = None  # for server-side fallback

class ImageRequest(BaseModel):
    url: str
    image_url: str
    alt_text: str = ""

class YouTubeRequest(BaseModel):
    url: str
    video_id: str
    title: str
    channel: str = ""
    transcript: str
    duration_seconds: int = 0

class PDFRequest(BaseModel):
    url: str
    filename: str = ""
    content: str
    page_count: int = 0

class TwitterRequest(BaseModel):
    url: str
    author: str = ""
    thread_text: str
    tweet_count: int = 0

class TagCreate(BaseModel):
    name: str
    color: str = "#7c3aed"

class PageTagRequest(BaseModel):
    page_url: str
    page_title: str = ""
    tag_id: int

class SettingUpdate(BaseModel):
    key: str
    value: str


# ─── Health Check ────────────────────────────────────────────────────────────

@app.get("/api/health")
def health_check():
    """Simple health check endpoint for the Chrome extension to verify connectivity."""
    return {
        "status": "ok",
        "timestamp": datetime.utcnow().isoformat(),
        "version": "2.0.0"
    }


# ─── Stats ───────────────────────────────────────────────────────────────────

@app.get("/api/stats")
def get_stats(db: Session = Depends(get_db)):
    """Return today's capture counts for the dashboard cards."""
    today_start = datetime.combine(date.today(), datetime.min.time())

    texts = db.query(func.count(CapturedText.id)).filter(
        CapturedText.timestamp >= today_start
    ).scalar() or 0

    images = db.query(func.count(CapturedImage.id)).filter(
        CapturedImage.timestamp >= today_start
    ).scalar() or 0

    audios = db.query(func.count(CapturedAudio.id)).filter(
        CapturedAudio.timestamp >= today_start
    ).scalar() or 0

    youtubes = db.query(func.count(CapturedYouTube.id)).filter(
        CapturedYouTube.timestamp >= today_start
    ).scalar() or 0

    pdfs = db.query(func.count(CapturedPDF.id)).filter(
        CapturedPDF.timestamp >= today_start
    ).scalar() or 0

    tweets = db.query(func.count(CapturedTwitterThread.id)).filter(
        CapturedTwitterThread.timestamp >= today_start
    ).scalar() or 0

    return {
        "texts": texts,
        "images": images,
        "audios": audios,
        "youtubes": youtubes,
        "pdfs": pdfs,
        "tweets": tweets,
        "date": date.today().isoformat()
    }


# ─── Clear Today's Data ─────────────────────────────────────────────────────

@app.post("/api/clear-today")
def clear_today(db: Session = Depends(get_db)):
    """Delete all captured data from today."""
    today_start = datetime.combine(date.today(), datetime.min.time())

    deleted_texts = db.query(CapturedText).filter(
        CapturedText.timestamp >= today_start
    ).delete(synchronize_session=False)

    deleted_images = db.query(CapturedImage).filter(
        CapturedImage.timestamp >= today_start
    ).delete(synchronize_session=False)

    deleted_audios = db.query(CapturedAudio).filter(
        CapturedAudio.timestamp >= today_start
    ).delete(synchronize_session=False)

    deleted_youtubes = db.query(CapturedYouTube).filter(
        CapturedYouTube.timestamp >= today_start
    ).delete(synchronize_session=False)

    deleted_pdfs = db.query(CapturedPDF).filter(
        CapturedPDF.timestamp >= today_start
    ).delete(synchronize_session=False)

    deleted_tweets = db.query(CapturedTwitterThread).filter(
        CapturedTwitterThread.timestamp >= today_start
    ).delete(synchronize_session=False)

    db.commit()

    return {
        "status": "success",
        "deleted": {
            "texts": deleted_texts,
            "images": deleted_images,
            "audios": deleted_audios,
            "youtubes": deleted_youtubes,
            "pdfs": deleted_pdfs,
            "tweets": deleted_tweets,
        }
    }


# ─── Capture Endpoints ──────────────────────────────────────────────────────

def update_fts_index(db, table_name, row_id, columns_dict):
    """Insert a row into the FTS index."""
    try:
        cols = ", ".join(columns_dict.keys())
        placeholders = ", ".join([f":{k}" for k in columns_dict.keys()])
        db.execute(
            text(f"INSERT INTO {table_name}_fts(rowid, {cols}) VALUES (:rowid, {placeholders})"),
            {"rowid": row_id, **columns_dict}
        )
        db.commit()
    except Exception as e:
        print(f"FTS index update warning: {e}")


@app.post("/api/text")
def save_text(req: TextRequest, db: Session = Depends(get_db)):
    content = req.content
    extraction_method = req.extraction_method

    # Server-side fallback: if raw_html is provided and extraction was raw, try trafilatura
    if req.raw_html and extraction_method == "raw":
        try:
            import trafilatura
            extracted = trafilatura.extract(req.raw_html)
            if extracted and len(extracted) > 50:
                content = extracted
                extraction_method = "server"
        except Exception:
            pass  # keep client-side content

    db_text = CapturedText(
        url=req.url,
        title=req.title,
        content=content,
        dwell_time_ms=req.dwell_time_ms,
        extraction_method=extraction_method,
    )
    db.add(db_text)
    db.commit()
    db.refresh(db_text)

    # Update FTS index
    update_fts_index(db, "captured_text", db_text.id, {
        "title": req.title, "content": content, "url": req.url
    })

    return {"status": "success", "id": db_text.id}


@app.post("/api/images")
def save_images(req: List[ImageRequest], db: Session = Depends(get_db)):
    for img in req:
        db_img = CapturedImage(url=img.url, image_url=img.image_url, alt_text=img.alt_text)
        db.add(db_img)
    db.commit()
    return {"status": "success", "count": len(req)}


@app.post("/api/audio")
async def save_audio(url: str = Form(...), file: UploadFile = File(...), db: Session = Depends(get_db)):
    filename = f"audio_uploads/{datetime.now().strftime('%Y%m%d_%H%M%S')}_{file.filename}"
    with open(filename, "wb") as f:
        f.write(await file.read())

    db_audio = CapturedAudio(url=url, filename=filename)
    db.add(db_audio)
    db.commit()
    return {"status": "success", "filename": filename}


@app.post("/api/youtube")
def save_youtube(req: YouTubeRequest, db: Session = Depends(get_db)):
    # Deduplicate by video_id for today
    today_start = datetime.combine(date.today(), datetime.min.time())
    existing = db.query(CapturedYouTube).filter(
        CapturedYouTube.video_id == req.video_id,
        CapturedYouTube.timestamp >= today_start
    ).first()
    if existing:
        return {"status": "duplicate", "id": existing.id}

    db_yt = CapturedYouTube(
        url=req.url,
        video_id=req.video_id,
        title=req.title,
        channel=req.channel,
        transcript=req.transcript,
        duration_seconds=req.duration_seconds,
    )
    db.add(db_yt)
    db.commit()
    db.refresh(db_yt)

    update_fts_index(db, "captured_youtube", db_yt.id, {
        "title": req.title, "channel": req.channel, "transcript": req.transcript
    })

    return {"status": "success", "id": db_yt.id}


@app.post("/api/pdf")
def save_pdf(req: PDFRequest, db: Session = Depends(get_db)):
    db_pdf = CapturedPDF(
        url=req.url,
        filename=req.filename,
        content=req.content,
        page_count=req.page_count,
    )
    db.add(db_pdf)
    db.commit()
    db.refresh(db_pdf)

    update_fts_index(db, "captured_pdf", db_pdf.id, {
        "filename": req.filename, "content": req.content
    })

    return {"status": "success", "id": db_pdf.id}


@app.post("/api/twitter")
def save_twitter(req: TwitterRequest, db: Session = Depends(get_db)):
    db_tw = CapturedTwitterThread(
        url=req.url,
        author=req.author,
        thread_text=req.thread_text,
        tweet_count=req.tweet_count,
    )
    db.add(db_tw)
    db.commit()
    db.refresh(db_tw)

    update_fts_index(db, "captured_twitter", db_tw.id, {
        "author": req.author, "thread_text": req.thread_text
    })

    return {"status": "success", "id": db_tw.id}


# ─── Full-Text Search ───────────────────────────────────────────────────────

@app.get("/api/search")
def search(q: str = Query(..., min_length=1), db: Session = Depends(get_db)):
    """Full-text search across all captured data and generated notes using FTS5."""
    results = []

    # Search captured text
    try:
        rows = db.execute(text(
            "SELECT rowid, snippet(captured_text_fts, 1, '<mark>', '</mark>', '...', 40) as snippet, "
            "title, url FROM captured_text_fts WHERE captured_text_fts MATCH :q ORDER BY rank LIMIT 20"
        ), {"q": q}).fetchall()
        for row in rows:
            results.append({
                "type": "text", "id": row[0], "snippet": row[1],
                "title": row[2], "url": row[3]
            })
    except Exception:
        pass

    # Search daily notes
    try:
        rows = db.execute(text(
            "SELECT rowid, snippet(daily_notes_fts, 1, '<mark>', '</mark>', '...', 40) as snippet, "
            "date FROM daily_notes_fts WHERE daily_notes_fts MATCH :q ORDER BY rank LIMIT 10"
        ), {"q": q}).fetchall()
        for row in rows:
            results.append({
                "type": "note", "id": row[0], "snippet": row[1], "date": row[2]
            })
    except Exception:
        pass

    # Search YouTube transcripts
    try:
        rows = db.execute(text(
            "SELECT rowid, snippet(captured_youtube_fts, 2, '<mark>', '</mark>', '...', 40) as snippet, "
            "title, channel FROM captured_youtube_fts WHERE captured_youtube_fts MATCH :q ORDER BY rank LIMIT 10"
        ), {"q": q}).fetchall()
        for row in rows:
            results.append({
                "type": "youtube", "id": row[0], "snippet": row[1],
                "title": row[2], "channel": row[3]
            })
    except Exception:
        pass

    # Search PDFs
    try:
        rows = db.execute(text(
            "SELECT rowid, snippet(captured_pdf_fts, 1, '<mark>', '</mark>', '...', 40) as snippet, "
            "filename FROM captured_pdf_fts WHERE captured_pdf_fts MATCH :q ORDER BY rank LIMIT 10"
        ), {"q": q}).fetchall()
        for row in rows:
            results.append({
                "type": "pdf", "id": row[0], "snippet": row[1], "filename": row[2]
            })
    except Exception:
        pass

    # Search Twitter threads
    try:
        rows = db.execute(text(
            "SELECT rowid, snippet(captured_twitter_fts, 1, '<mark>', '</mark>', '...', 40) as snippet, "
            "author FROM captured_twitter_fts WHERE captured_twitter_fts MATCH :q ORDER BY rank LIMIT 10"
        ), {"q": q}).fetchall()
        for row in rows:
            results.append({
                "type": "twitter", "id": row[0], "snippet": row[1], "author": row[2]
            })
    except Exception:
        pass

    return {"status": "success", "query": q, "results": results, "total": len(results)}


# ─── Journal Notes ───────────────────────────────────────────────────────────

@app.get("/api/notes")
def list_notes(
    note_type: Optional[str] = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db)
):
    """List all generated notes (daily, weekly, monthly)."""
    query = db.query(DailyNote).order_by(desc(DailyNote.generated_at))

    if note_type:
        query = query.filter(DailyNote.note_type == note_type)

    total = query.count()
    notes = query.offset(offset).limit(limit).all()

    return {
        "status": "success",
        "total": total,
        "notes": [
            {
                "id": n.id,
                "date": n.date,
                "note_type": n.note_type,
                "filepath": n.filepath,
                "generated_at": n.generated_at.isoformat() if n.generated_at else None,
                "preview": (n.content[:200] + "...") if n.content and len(n.content) > 200 else n.content
            }
            for n in notes
        ]
    }


@app.get("/api/notes/{note_date}")
def get_note(note_date: str, db: Session = Depends(get_db)):
    """Get a specific note's full markdown content."""
    note = db.query(DailyNote).filter(DailyNote.date == note_date).first()
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")

    return {
        "status": "success",
        "note": {
            "id": note.id,
            "date": note.date,
            "note_type": note.note_type,
            "content": note.content,
            "filepath": note.filepath,
            "generated_at": note.generated_at.isoformat() if note.generated_at else None,
        }
    }


# ─── Tags ────────────────────────────────────────────────────────────────────

@app.get("/api/tags")
def list_tags(db: Session = Depends(get_db)):
    tags = db.query(Tag).all()
    return {
        "status": "success",
        "tags": [
            {"id": t.id, "name": t.name, "color": t.color, "page_count": len(t.pages)}
            for t in tags
        ]
    }

@app.post("/api/tags")
def create_tag(req: TagCreate, db: Session = Depends(get_db)):
    existing = db.query(Tag).filter(Tag.name == req.name).first()
    if existing:
        raise HTTPException(status_code=409, detail="Tag already exists")
    tag = Tag(name=req.name, color=req.color)
    db.add(tag)
    db.commit()
    db.refresh(tag)
    return {"status": "success", "tag": {"id": tag.id, "name": tag.name, "color": tag.color}}

@app.delete("/api/tags/{tag_id}")
def delete_tag(tag_id: int, db: Session = Depends(get_db)):
    tag = db.query(Tag).filter(Tag.id == tag_id).first()
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found")
    db.delete(tag)
    db.commit()
    return {"status": "success"}

@app.post("/api/tag-page")
def tag_page(req: PageTagRequest, db: Session = Depends(get_db)):
    # Check tag exists
    tag = db.query(Tag).filter(Tag.id == req.tag_id).first()
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found")
    # Check for duplicate
    existing = db.query(PageTag).filter(
        PageTag.page_url == req.page_url, PageTag.tag_id == req.tag_id
    ).first()
    if existing:
        return {"status": "duplicate"}
    pt = PageTag(page_url=req.page_url, page_title=req.page_title, tag_id=req.tag_id)
    db.add(pt)
    db.commit()
    return {"status": "success"}

@app.delete("/api/tag-page/{page_tag_id}")
def untag_page(page_tag_id: int, db: Session = Depends(get_db)):
    pt = db.query(PageTag).filter(PageTag.id == page_tag_id).first()
    if not pt:
        raise HTTPException(status_code=404, detail="Page tag not found")
    db.delete(pt)
    db.commit()
    return {"status": "success"}

@app.get("/api/tagged-pages")
def get_tagged_pages(tag: Optional[str] = None, db: Session = Depends(get_db)):
    query = db.query(PageTag)
    if tag:
        tag_obj = db.query(Tag).filter(Tag.name == tag).first()
        if not tag_obj:
            return {"status": "success", "pages": []}
        query = query.filter(PageTag.tag_id == tag_obj.id)

    pages = query.order_by(desc(PageTag.created_at)).all()
    return {
        "status": "success",
        "pages": [
            {
                "id": p.id, "page_url": p.page_url, "page_title": p.page_title,
                "tag_id": p.tag_id, "tag_name": p.tag.name, "tag_color": p.tag.color,
                "created_at": p.created_at.isoformat() if p.created_at else None,
            }
            for p in pages
        ]
    }


# ─── Settings ───────────────────────────────────────────────────────────────

DEFAULT_SETTINGS = {
    "ai_provider": "gemini",
    "gemini_api_key": "",
    "local_ai_endpoint": "http://localhost:1234/v1",
    "local_model_name": "local-model",
    "domain_blocklist": "mail.google.com,banking.example.com",
    "dwell_time_threshold": "0",
    "theme": "dark",
    "capture_images": "true",
    "capture_audio": "true",
}

@app.get("/api/settings")
def get_settings(db: Session = Depends(get_db)):
    settings = db.query(UserSettings).all()
    result = dict(DEFAULT_SETTINGS)
    for s in settings:
        result[s.key] = s.value

    # Override with .env values for secrets
    env_key = os.getenv("GEMINI_API_KEY", "")
    if env_key:
        result["gemini_api_key"] = env_key
    env_provider = os.getenv("AI_PROVIDER", "")
    if env_provider:
        result["ai_provider"] = env_provider

    return {"status": "success", "settings": result}

@app.put("/api/settings")
def update_settings(updates: List[SettingUpdate], db: Session = Depends(get_db)):
    for update in updates:
        existing = db.query(UserSettings).filter(UserSettings.key == update.key).first()
        if existing:
            existing.value = update.value
        else:
            db.add(UserSettings(key=update.key, value=update.value))
    db.commit()
    return {"status": "success"}


# ─── Raw Data Browser ───────────────────────────────────────────────────────

@app.get("/api/captured")
def browse_captured(
    type: str = Query("text", pattern="^(text|images|audio|youtube|pdf|twitter)$"),
    date_str: Optional[str] = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db)
):
    """Paginated endpoint to browse raw captured data."""
    type_map = {
        "text": CapturedText,
        "images": CapturedImage,
        "audio": CapturedAudio,
        "youtube": CapturedYouTube,
        "pdf": CapturedPDF,
        "twitter": CapturedTwitterThread,
    }
    model = type_map[type]
    query = db.query(model).order_by(desc(model.timestamp))

    if date_str:
        try:
            target_date = datetime.strptime(date_str, "%Y-%m-%d").date()
            day_start = datetime.combine(target_date, datetime.min.time())
            day_end = datetime.combine(target_date + timedelta(days=1), datetime.min.time())
            query = query.filter(model.timestamp >= day_start, model.timestamp < day_end)
        except ValueError:
            pass

    total = query.count()
    items = query.offset(offset).limit(limit).all()

    def serialize(item):
        result = {"id": item.id, "timestamp": item.timestamp.isoformat() if item.timestamp else None}
        if hasattr(item, 'url'):
            result["url"] = item.url
        if hasattr(item, 'title'):
            result["title"] = item.title
        if hasattr(item, 'content'):
            result["content"] = item.content[:500] if item.content else ""
        if hasattr(item, 'image_url'):
            result["image_url"] = item.image_url
        if hasattr(item, 'alt_text'):
            result["alt_text"] = item.alt_text
        if hasattr(item, 'filename'):
            result["filename"] = item.filename
        if hasattr(item, 'video_id'):
            result["video_id"] = item.video_id
        if hasattr(item, 'channel'):
            result["channel"] = item.channel
        if hasattr(item, 'transcript'):
            result["transcript"] = item.transcript[:500] if item.transcript else ""
        if hasattr(item, 'author'):
            result["author"] = item.author
        if hasattr(item, 'thread_text'):
            result["thread_text"] = item.thread_text[:500] if item.thread_text else ""
        if hasattr(item, 'dwell_time_ms'):
            result["dwell_time_ms"] = item.dwell_time_ms
        if hasattr(item, 'extraction_method'):
            result["extraction_method"] = item.extraction_method
        if hasattr(item, 'page_count'):
            result["page_count"] = item.page_count
        if hasattr(item, 'tweet_count'):
            result["tweet_count"] = item.tweet_count
        if hasattr(item, 'duration_seconds'):
            result["duration_seconds"] = item.duration_seconds
        return result

    return {
        "status": "success",
        "type": type,
        "total": total,
        "items": [serialize(i) for i in items]
    }


# ─── AI Summary Generation ──────────────────────────────────────────────────

def build_summary_prompt(texts, images, youtubes, pdfs, tweets, note_type="daily"):
    """Build a rich, structured prompt for AI summary generation."""
    visited_urls = set()
    for t in texts:
        visited_urls.add(t.url)
    for i in images:
        visited_urls.add(i.url)

    prompt = """You are an expert personal journal writer. Based on the following browsing data captured throughout the day, write a rich, insightful daily journal entry.

## FORMAT REQUIREMENTS:
1. **Categorized Sections** — Group the content by topic/theme (e.g., "🔬 Research & Learning", "🎮 Entertainment", "📰 News", "💻 Development", "📱 Social Media", etc.). Use relevant emoji for each category.
2. **Key Takeaways** — Under each category, list the most important learnings, facts, or insights as bullet points.
3. **Time-Based Flow** — If timestamps are available, organize content into Morning / Afternoon / Evening sections within each category.
4. **Mood & Productivity Analysis** — At the end, add a "📊 Daily Analysis" section that infers:
   - Overall focus areas
   - How productive/scattered the browsing was
   - Dominant themes of the day
   - A "focus score" out of 10

## DATA CAPTURED TODAY:

"""

    # Text content
    if texts:
        prompt += "### 📝 Pages Visited:\n"
        for t in texts:
            time_str = t.timestamp.strftime("%H:%M") if t.timestamp else "unknown"
            content_preview = t.content[:400] if t.content else ""
            prompt += f"- [{time_str}] **{t.title}** ({t.url})\n  {content_preview}\n\n"

    # YouTube transcripts
    if youtubes:
        prompt += "\n### 🎬 YouTube Videos Watched:\n"
        for yt in youtubes:
            time_str = yt.timestamp.strftime("%H:%M") if yt.timestamp else "unknown"
            transcript_preview = yt.transcript[:600] if yt.transcript else ""
            prompt += f"- [{time_str}] **{yt.title}** by {yt.channel}\n  Transcript excerpt: {transcript_preview}\n\n"

    # PDFs
    if pdfs:
        prompt += "\n### 📄 PDFs Read:\n"
        for pdf in pdfs:
            content_preview = pdf.content[:400] if pdf.content else ""
            prompt += f"- **{pdf.filename or pdf.url}** ({pdf.page_count} pages)\n  {content_preview}\n\n"

    # Twitter threads
    if tweets:
        prompt += "\n### 🐦 Twitter/X Threads:\n"
        for tw in tweets:
            thread_preview = tw.thread_text[:400] if tw.thread_text else ""
            prompt += f"- **@{tw.author}** ({tw.tweet_count} tweets)\n  {thread_preview}\n\n"

    # Images (summary only)
    if images:
        prompt += f"\n### 🖼️ Images Encountered: {len(images)} images across {len(set(i.url for i in images))} pages\n"

    if note_type == "weekly":
        prompt = prompt.replace("daily journal entry", "weekly summary journal entry")
        prompt += "\n\n## ADDITIONAL INSTRUCTION: This is a WEEKLY summary. Identify recurring themes across the week and highlight trends in browsing behavior.\n"
    elif note_type == "monthly":
        prompt = prompt.replace("daily journal entry", "monthly summary journal entry")
        prompt += "\n\n## ADDITIONAL INSTRUCTION: This is a MONTHLY summary. Provide a high-level overview of the month's themes, major topics explored, and evolution of interests.\n"

    prompt += "\n\nNow write the journal entry in Markdown format:"

    return prompt, visited_urls


def call_ai(prompt):
    """Call the configured AI provider and return the response text."""
    ai_provider = os.getenv("AI_PROVIDER", "gemini").lower()

    if ai_provider == "gemini":
        import google.generativeai as genai

        gemini_api_key = os.getenv("GEMINI_API_KEY")
        if not gemini_api_key:
            raise Exception("GEMINI_API_KEY environment variable not found. Please create a .env file.")

        genai.configure(api_key=gemini_api_key)
        model = genai.GenerativeModel('gemini-2.0-flash')

        response = model.generate_content(prompt)
        return response.text
    else:
        # Local Provider (LM Studio, Ollama, etc.)
        local_endpoint = os.getenv("LOCAL_AI_ENDPOINT", "http://localhost:1234/v1")
        local_model = os.getenv("LOCAL_MODEL_NAME", "local-model")

        res = requests.post(f"{local_endpoint}/chat/completions", json={
            "model": local_model,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.7
        })
        res.raise_for_status()
        return res.json().get("choices", [{}])[0].get("message", {}).get("content", "")


@app.post("/api/generate-daily-note")
def generate_daily_note(db: Session = Depends(get_db)):
    """Generate a rich, categorized daily note."""
    today_start = datetime.combine(date.today(), datetime.min.time())

    texts = db.query(CapturedText).filter(CapturedText.timestamp >= today_start).all()
    images = db.query(CapturedImage).filter(CapturedImage.timestamp >= today_start).all()
    youtubes = db.query(CapturedYouTube).filter(CapturedYouTube.timestamp >= today_start).all()
    pdfs = db.query(CapturedPDF).filter(CapturedPDF.timestamp >= today_start).all()
    tweets = db.query(CapturedTwitterThread).filter(CapturedTwitterThread.timestamp >= today_start).all()

    if not texts and not images and not youtubes and not pdfs and not tweets:
        return {
            "status": "error",
            "message": "No data captured today. Browse some pages first!"
        }

    prompt, visited_urls = build_summary_prompt(texts, images, youtubes, pdfs, tweets, "daily")

    try:
        note_content = call_ai(prompt)
    except Exception as e:
        note_content = f"Error generating summary: {str(e)}\n\n(Check your .env settings)"

    # Save as Markdown file
    date_str = datetime.now().strftime("%Y-%m-%d")
    relative_path = f"daily_notes/journal_{date_str}.md"

    full_content = f"# 📓 Daily Journal — {date_str}\n\n{note_content}\n\n---\n\n## 🔗 Browsing History\n"
    for url in visited_urls:
        full_content += f"- {url}\n"

    with open(relative_path, "w", encoding="utf-8") as f:
        f.write(full_content)

    # Save to database
    existing_note = db.query(DailyNote).filter(DailyNote.date == date_str).first()
    if existing_note:
        existing_note.content = full_content
        existing_note.filepath = os.path.abspath(relative_path)
        existing_note.generated_at = datetime.utcnow()
    else:
        db_note = DailyNote(
            date=date_str,
            note_type="daily",
            filepath=os.path.abspath(relative_path),
            content=full_content,
        )
        db.add(db_note)
    db.commit()

    # Update FTS
    note_obj = db.query(DailyNote).filter(DailyNote.date == date_str).first()
    if note_obj:
        try:
            db.execute(text("DELETE FROM daily_notes_fts WHERE rowid = :rid"), {"rid": note_obj.id})
            db.execute(
                text("INSERT INTO daily_notes_fts(rowid, date, content) VALUES (:rid, :date, :content)"),
                {"rid": note_obj.id, "date": date_str, "content": full_content}
            )
            db.commit()
        except Exception:
            pass

    return {
        "status": "success",
        "filepath": os.path.abspath(relative_path),
        "relative_path": relative_path
    }


@app.post("/api/generate-weekly-note")
def generate_weekly_note(db: Session = Depends(get_db)):
    """Generate a weekly rollup summary from the past 7 days of daily notes."""
    week_ago = datetime.combine(date.today() - timedelta(days=7), datetime.min.time())

    texts = db.query(CapturedText).filter(CapturedText.timestamp >= week_ago).all()
    images = db.query(CapturedImage).filter(CapturedImage.timestamp >= week_ago).all()
    youtubes = db.query(CapturedYouTube).filter(CapturedYouTube.timestamp >= week_ago).all()
    pdfs = db.query(CapturedPDF).filter(CapturedPDF.timestamp >= week_ago).all()
    tweets = db.query(CapturedTwitterThread).filter(CapturedTwitterThread.timestamp >= week_ago).all()

    if not texts and not images and not youtubes and not pdfs and not tweets:
        return {"status": "error", "message": "No data captured this week."}

    prompt, visited_urls = build_summary_prompt(texts, images, youtubes, pdfs, tweets, "weekly")

    try:
        note_content = call_ai(prompt)
    except Exception as e:
        note_content = f"Error generating weekly summary: {str(e)}"

    today = date.today()
    week_number = today.isocalendar()[1]
    week_str = f"{today.year}-W{week_number:02d}"
    relative_path = f"daily_notes/weekly_{week_str}.md"

    full_content = f"# 📅 Weekly Summary — Week {week_number}, {today.year}\n\n{note_content}\n"

    with open(relative_path, "w", encoding="utf-8") as f:
        f.write(full_content)

    existing_note = db.query(DailyNote).filter(DailyNote.date == week_str).first()
    if existing_note:
        existing_note.content = full_content
        existing_note.filepath = os.path.abspath(relative_path)
        existing_note.generated_at = datetime.utcnow()
    else:
        db_note = DailyNote(date=week_str, note_type="weekly", filepath=os.path.abspath(relative_path), content=full_content)
        db.add(db_note)
    db.commit()

    return {"status": "success", "filepath": os.path.abspath(relative_path), "relative_path": relative_path}


@app.post("/api/generate-monthly-note")
def generate_monthly_note(db: Session = Depends(get_db)):
    """Generate a monthly rollup summary."""
    today = date.today()
    month_start = datetime.combine(today.replace(day=1), datetime.min.time())

    texts = db.query(CapturedText).filter(CapturedText.timestamp >= month_start).all()
    images = db.query(CapturedImage).filter(CapturedImage.timestamp >= month_start).all()
    youtubes = db.query(CapturedYouTube).filter(CapturedYouTube.timestamp >= month_start).all()
    pdfs = db.query(CapturedPDF).filter(CapturedPDF.timestamp >= month_start).all()
    tweets = db.query(CapturedTwitterThread).filter(CapturedTwitterThread.timestamp >= month_start).all()

    if not texts and not images and not youtubes and not pdfs and not tweets:
        return {"status": "error", "message": "No data captured this month."}

    prompt, visited_urls = build_summary_prompt(texts, images, youtubes, pdfs, tweets, "monthly")

    try:
        note_content = call_ai(prompt)
    except Exception as e:
        note_content = f"Error generating monthly summary: {str(e)}"

    month_str = today.strftime("%Y-%m")
    relative_path = f"daily_notes/monthly_{month_str}.md"

    full_content = f"# 📆 Monthly Summary — {today.strftime('%B %Y')}\n\n{note_content}\n"

    with open(relative_path, "w", encoding="utf-8") as f:
        f.write(full_content)

    existing_note = db.query(DailyNote).filter(DailyNote.date == month_str).first()
    if existing_note:
        existing_note.content = full_content
        existing_note.filepath = os.path.abspath(relative_path)
        existing_note.generated_at = datetime.utcnow()
    else:
        db_note = DailyNote(date=month_str, note_type="monthly", filepath=os.path.abspath(relative_path), content=full_content)
        db.add(db_note)
    db.commit()

    return {"status": "success", "filepath": os.path.abspath(relative_path), "relative_path": relative_path}


# ─── Scheduled Tasks (APScheduler) ──────────────────────────────────────────

try:
    from apscheduler.schedulers.background import BackgroundScheduler
    from apscheduler.triggers.cron import CronTrigger

    scheduler = BackgroundScheduler()

    def scheduled_weekly():
        db = SessionLocal()
        try:
            generate_weekly_note(db=db)
        finally:
            db.close()

    def scheduled_monthly():
        db = SessionLocal()
        try:
            generate_monthly_note(db=db)
        finally:
            db.close()

    # Weekly: Every Sunday at 11 PM
    scheduler.add_job(scheduled_weekly, CronTrigger(day_of_week='sun', hour=23, minute=0))
    # Monthly: 1st of every month at 11 PM
    scheduler.add_job(scheduled_monthly, CronTrigger(day=1, hour=23, minute=0))

    scheduler.start()

    @app.on_event("shutdown")
    def shutdown_scheduler():
        scheduler.shutdown()

except ImportError:
    print("APScheduler not installed. Scheduled rollups disabled. Install with: pip install apscheduler")
