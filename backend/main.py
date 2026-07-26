import os
import json
import requests
from datetime import datetime
from fastapi import FastAPI, Depends, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List
from dotenv import load_dotenv

load_dotenv()

from database import SessionLocal, engine, CapturedText, CapturedImage, CapturedAudio

app = FastAPI()

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

# Dependency to get DB session
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# Pydantic models for incoming JSON requests
class TextRequest(BaseModel):
    url: str
    title: str
    content: str

class ImageRequest(BaseModel):
    url: str
    image_url: str
    alt_text: str = ""

@app.post("/api/text")
def save_text(req: TextRequest, db: Session = Depends(get_db)):
    # Basic deduplication based on exact content (or we could just insert)
    # Checking if we already captured exactly this recently is hard, let's just insert for now
    db_text = CapturedText(url=req.url, title=req.title, content=req.content)
    db.add(db_text)
    db.commit()
    return {"status": "success"}

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

@app.post("/api/generate-daily-note")
def generate_daily_note(db: Session = Depends(get_db)):
    # 1. Fetch today's data
    today = datetime.utcnow().date()
    # (In a real app we'd filter by today's date using SQLAlchemy, for now let's just get everything to keep it simple, or actually let's filter)
    # Using python filtering for simplicity here since datetime in SQLite can be tricky with timezone
    
    texts = db.query(CapturedText).all()
    images = db.query(CapturedImage).all()
    
    # Simple deduplication based on URL for the prompt
    visited_urls = set([t.url for t in texts] + [i.url for i in images])
    
    summary_prompt = f"I browsed the following URLs today: {', '.join(visited_urls)}.\n\n"
    summary_prompt += "Here are some snippets of text I saw:\n"
    for t in texts[-10:]: # Limit to last 10 to not overflow context for now
        summary_prompt += f"- {t.title}: {t.content[:200]}...\n"
        
    summary_prompt += "\nPlease write a brief daily journal entry summarizing what I was looking at today."

    # 2. Call AI Provider
    ai_provider = os.getenv("AI_PROVIDER", "gemini").lower()
    
    try:
        if ai_provider == "gemini":
            import google.generativeai as genai
            
            gemini_api_key = os.getenv("GEMINI_API_KEY")
            if not gemini_api_key:
                raise Exception("GEMINI_API_KEY environment variable not found. Please create a .env file.")
                
            genai.configure(api_key=gemini_api_key)
            model = genai.GenerativeModel('gemini-1.5-pro-latest')
            
            response = model.generate_content(summary_prompt)
            note_content = response.text
        else:
            # Local Provider (LM Studio, Ollama, etc. using OpenAI compatible API)
            local_endpoint = os.getenv("LOCAL_AI_ENDPOINT", "http://localhost:1234/v1")
            local_model = os.getenv("LOCAL_MODEL_NAME", "local-model")
            
            # Using simple requests for OpenAI-compatible endpoint
            import requests
            res = requests.post(f"{local_endpoint}/chat/completions", json={
                "model": local_model,
                "messages": [{"role": "user", "content": summary_prompt}],
                "temperature": 0.7
            })
            res.raise_for_status()
            note_content = res.json().get("choices", [{}])[0].get("message", {}).get("content", "")
            
    except Exception as e:
        note_content = f"Error generating summary from {ai_provider}: {str(e)}\n\n(Check your .env settings and ensure your local AI is running if applicable)"
        
    # 3. Save as Markdown file
    date_str = datetime.now().strftime("%Y-%m-%d")
    filepath = f"daily_notes/journal_{date_str}.md"
    
    with open(filepath, "w", encoding="utf-8") as f:
        f.write(f"# Daily Note - {date_str}\n\n")
        f.write(note_content)
        f.write("\n\n## Browsing History\n")
        for url in visited_urls:
            f.write(f"- {url}\n")
            
    return {"status": "success", "filepath": filepath}
