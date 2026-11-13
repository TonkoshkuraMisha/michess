# --- FILE: src/api/themes.py ---
"""Реестр тактических приёмов (таск 13.0): клиент получает коды, разделы, родителей и минимумы; тексты — у него."""

from fastapi import APIRouter

from src.services.themes import SECTIONS, registry_payload

router = APIRouter()


@router.get("")
async def list_themes() -> dict:
    """Разделы A–L и все темы реестра в порядке каталога."""
    return {"sections": list(SECTIONS), "themes": registry_payload()}
