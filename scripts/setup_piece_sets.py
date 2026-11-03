# --- FILE: scripts/setup_piece_sets.py ---

import shutil
import urllib.request
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
PIECES_ROOT = PROJECT_ROOT / "frontend" / "public" / "assets" / "pieces"

PIECE_CODES = ["wP", "wN", "wB", "wR", "wQ", "wK", "bP", "bN", "bB", "bR", "bQ", "bK"]

REMOTE_SETS = {
    "merida": "https://raw.githubusercontent.com/lichess-org/lila/master/public/piece/merida/{code}.svg",
    "alpha": "https://raw.githubusercontent.com/lichess-org/lila/master/public/piece/alpha/{code}.svg",
    "cburnett": "https://raw.githubusercontent.com/lichess-org/lila/master/public/piece/cburnett/{code}.svg",
    "maestro": "https://raw.githubusercontent.com/lichess-org/lila/master/public/piece/maestro/{code}.svg",
}


def make_cardinal_outlined_svg(base_svg: str, code: str) -> str:
    is_black = code.startswith("b")
    halo_color = "#FFFFFF" if is_black else "#111827"
    filter_id = f"cardinal_halo_{code}"

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


def backup_existing_classic_pieces() -> None:
    classic_dir = PIECES_ROOT / "classic"
    classic_dir.mkdir(parents=True, exist_ok=True)
    for code in PIECE_CODES:
        root_svg = PIECES_ROOT / f"{code}.svg"
        target_svg = classic_dir / f"{code}.svg"
        if root_svg.exists() and not target_svg.exists():
            shutil.copy2(root_svg, target_svg)


def download_svg(url: str) -> str | None:
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "Michess-PieceSetup/1.0"},
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            if resp.status == 200:
                text = resp.read().decode("utf-8", errors="ignore")
                if "<svg" in text:
                    return text
    except Exception as exc:
        print(f"[!] Предупреждение при загрузке {url}: {exc}")
    return None


def setup_all_piece_sets() -> None:
    PIECES_ROOT.mkdir(parents=True, exist_ok=True)
    backup_existing_classic_pieces()
    classic_dir = PIECES_ROOT / "classic"

    for set_name, url_tpl in REMOTE_SETS.items():
        set_dir = PIECES_ROOT / set_name
        set_dir.mkdir(parents=True, exist_ok=True)
        downloaded_count = 0

        for code in PIECE_CODES:
            target_file = set_dir / f"{code}.svg"
            if target_file.exists() and target_file.stat().st_size > 200:
                downloaded_count += 1
                continue

            svg_content = download_svg(url_tpl.format(code=code))
            if svg_content:
                target_file.write_text(svg_content, encoding="utf-8")
                downloaded_count += 1
            elif (classic_dir / f"{code}.svg").exists():
                shutil.copy2(classic_dir / f"{code}.svg", target_file)

        print(f"[+] Набор '{set_name:8s}' готов ({downloaded_count}/12 фигур) -> {set_dir.relative_to(PROJECT_ROOT)}")

    cardinal_dir = PIECES_ROOT / "cardinal"
    cardinal_dir.mkdir(parents=True, exist_ok=True)
    merida_dir = PIECES_ROOT / "merida"

    for code in PIECE_CODES:
        src_file = merida_dir / f"{code}.svg"
        if not src_file.exists():
            src_file = classic_dir / f"{code}.svg"
        if src_file.exists():
            raw_svg = src_file.read_text(encoding="utf-8")
            outlined_svg = make_cardinal_outlined_svg(raw_svg, code)
            (cardinal_dir / f"{code}.svg").write_text(outlined_svg, encoding="utf-8")

    print(f"[+] Набор 'cardinal' готов (12/12 фигур) -> {cardinal_dir.relative_to(PROJECT_ROOT)}")

    for code in PIECE_CODES:
        merida_svg = merida_dir / f"{code}.svg"
        if merida_svg.exists():
            shutil.copy2(merida_svg, PIECES_ROOT / f"{code}.svg")

    print("[+] Все 5 комплектов шахматных фигур (60 SVG-файлов) успешно установлены!")


if __name__ == "__main__":
    setup_all_piece_sets()
