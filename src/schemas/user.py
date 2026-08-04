from pydantic import BaseModel, Field, ConfigDict
from datetime import datetime

class UserCreate(BaseModel):
    """Schema for incoming user registration data."""
    username: str = Field(..., min_length=3, max_length=50, description="Unique username")
    password: str = Field(..., min_length=8, description="Strong password")

class UserResponse(BaseModel):
    """Schema for outgoing user data (password excluded)."""
    id: int
    username: str
    rating: int
    is_cheater: bool
    trust_factor: int
    created_at: datetime

    # This config allows Pydantic to read data directly from SQLAlchemy models
    model_config = ConfigDict(from_attributes=True)