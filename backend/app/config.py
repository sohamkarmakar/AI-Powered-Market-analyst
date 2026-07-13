import os
from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import Optional

class Settings(BaseSettings):
    # App Settings
    app_name: str = "AI Powered Market Analyst"
    debug: bool = True
    port: int = 8000
    host: str = "0.0.0.0"

    # Supabase Credentials
    supabase_url: Optional[str] = None
    supabase_key: Optional[str] = None

    # Gemini API Key
    gemini_api_key: Optional[str] = None

    # Load from a .env file if it exists
    model_config = SettingsConfigDict(
        env_file=os.path.join(os.path.dirname(os.path.dirname(__file__)), ".env"),
        env_file_encoding="utf-8",
        extra="ignore"
    )

settings = Settings()
