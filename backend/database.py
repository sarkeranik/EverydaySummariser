import os
from sqlalchemy import create_engine, Column, Integer, String, Text, DateTime
from sqlalchemy.orm import declarative_base, sessionmaker
from datetime import datetime

os.makedirs("data", exist_ok=True)
DATABASE_URL = "sqlite:///./data/journal.db"

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

class CapturedText(Base):
    __tablename__ = "captured_text"
    id = Column(Integer, primary_key=True, index=True)
    url = Column(String, index=True)
    title = Column(String)
    content = Column(Text)
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
    filename = Column(String) # path to local audio file
    timestamp = Column(DateTime, default=datetime.utcnow)

# Create all tables in the engine.
Base.metadata.create_all(bind=engine)
