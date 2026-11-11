# --- FILE: scripts/setup_piece_sets.py ---
"""
Скачивает наборы фигур в frontend/public/assets/pieces.

Источник — репозиторий lichess (lila), но берутся только наборы, которые его COPYING.md относит
к свободным и которые можно использовать в любом проекте, включая коммерческий. Наборы с
условием «некоммерческое использование» (CC BY-NC-SA, «free for personal non commercial use»)
и наборы без указанной лицензии сюда не добавляются.

Добавляя набор: сверить лицензию в https://github.com/lichess-org/lila/blob/master/COPYING.md,
вписать его в PIECE_SETS ниже, в frontend/src/config/boardAppearance.ts и в ATTRIBUTION.md —
tests/test_assets_licensing.py проверяет, что все три списка совпадают.
"""

import urllib.request
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
PIECES_ROOT = PROJECT_ROOT / "frontend" / "public" / "assets" / "pieces"

PIECE_CODES = ["wP", "wN", "wB", "wR", "wQ", "wK", "bP", "bN", "bB", "bR", "bQ", "bK"]

LILA_PIECE_URL = "https://raw.githubusercontent.com/lichess-org/lila/master/public/piece/{name}/{code}.svg"

# Папка набора -> (автор, лицензия). Единственный источник правды о том, что лежит в pieces/.
PIECE_SETS: dict[str, tuple[str, str]] = {
    "merida": ("Armando Hernandez Marroquin", "GPL-2.0-or-later"),
    "cburnett": ("Colin M.L. Burnett", "GPL-2.0-or-later"),
    "chessnut": ("Alexis Luengas", "Apache-2.0"),
    "fantasy": ("Maurizio Monge", "MIT"),
    "rhosgfx": ("RhosGFX", "CC0-1.0"),
}

# Собственная производная от merida (белая/тёмная окантовка) — наследует её лицензию.
OUTLINE_SET = "outline"
OUTLINE_SOURCE = "merida"
DERIVED_SETS: dict[str, tuple[str, str]] = {
    OUTLINE_SET: ("michess, на основе Merida (Armando Hernandez Marroquin)", "GPL-2.0-or-later"),
}


def make_outlined_svg(base_svg: str, code: str) -> str:
    is_black = code.startswith("b")
    halo_color = "#FFFFFF" if is_black else "#111827"
    filter_id = f"outline_halo_{code}"

    halo_def = (
        f'<defs><filter id="{filter_id}" x="-12%" y="-12%" width="124%" height="124%">'
        f'<feMorphology in="SourceAlpha" operator="dilate" radius="1.15" result="dilated"/>'
        f'<feFlood flood-color="{halo_color}" flood-opacity="0.98" result="flood"/>'
        f'<feComposite in="flood" in2="dilated" operator="in" result="outline"/>'
        f'<feMerge><feMergeNode in="outline"/><feMergeNode in="SourceGraphic"/></feMerge>'
        f'</filter></defs>'
    )

    idx = base_svg.find(">")
    if idx == -1 or "</svg>" not in base_svg:
        return base_svg

    header = base_svg[: idx + 1]
    body = base_svg[idx + 1:].replace("</svg>", "")
    return f'{header}{halo_def}<g filter="url(#{filter_id})">{body}</g></svg>\n'


def download_svg(url: str) -> str | None:
    req = urllib.request.Request(url, headers={"User-Agent": "piece-set-setup/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            if resp.status == 200:
                text = resp.read().decode("utf-8", errors="ignore")
                if "<svg" in text:
                    return text
    except Exception as exc:
        print(f"[!] Не удалось загрузить {url}: {exc}")
    return None


def setup_all_piece_sets() -> None:
    PIECES_ROOT.mkdir(parents=True, exist_ok=True)

    for set_name in PIECE_SETS:
        set_dir = PIECES_ROOT / set_name
        set_dir.mkdir(parents=True, exist_ok=True)
        ready = 0
        for code in PIECE_CODES:
            target_file = set_dir / f"{code}.svg"
            if target_file.exists() and target_file.stat().st_size > 200:
                ready += 1
                continue
            svg_content = download_svg(LILA_PIECE_URL.format(name=set_name, code=code))
            if svg_content:
                target_file.write_text(svg_content, encoding="utf-8")
                ready += 1
        print(f"[+] Набор '{set_name}' готов ({ready}/12 фигур)")

    outline_dir = PIECES_ROOT / OUTLINE_SET
    outline_dir.mkdir(parents=True, exist_ok=True)
    for code in PIECE_CODES:
        src_file = PIECES_ROOT / OUTLINE_SOURCE / f"{code}.svg"
        if src_file.exists():
            outlined = make_outlined_svg(src_file.read_text(encoding="utf-8"), code)
            (outline_dir / f"{code}.svg").write_text(outlined, encoding="utf-8")
    print(f"[+] Набор '{OUTLINE_SET}' собран из '{OUTLINE_SOURCE}'")


if __name__ == "__main__":
    setup_all_piece_sets()
