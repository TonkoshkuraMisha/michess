# --- FILE: scripts/build_lewis_pieces.py ---
"""
Собственный набор фигур «Льюис» (таск 18.2): по мотивам льюисских шахмат XII века (общественное достояние) — сидящие
на тронах король и ферзь, епископ в митре с посохом, всадник, воин со щитом, пешка-гранёный камень. Рисунок —
собственная работа проекта (CC0), формы упрощены до читаемых силуэтов на клетке 45×45.

    python scripts/build_lewis_pieces.py   → frontend/public/assets/pieces/lewis/{w,b}{K,Q,B,N,R,P}.svg
"""

from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "frontend" / "public" / "assets" / "pieces" / "lewis"

# Белые — моржовая кость, чёрные — кость, окрашенная в красное (как часть фигур находки).
COLORS = {
    "w": {"fill": "#F3E7CF", "shade": "#D9C29A", "line": "#3A2816"},
    "b": {"fill": "#7A2E24", "shade": "#5A1F18", "line": "#1C0B07"},
}

# Общие части: трон (спинка и сиденье) и основание.
THRONE = """
  <path d="M10 39 V17 Q10 12 15 12 H30 Q35 12 35 17 V39 Z" fill="{shade}"/>
  <path d="M10 17 H35 M10 22 H35" stroke="{line}" stroke-width="1" fill="none" opacity="0.6"/>"""
BASE = """
  <rect x="8" y="38" width="29" height="4" rx="1.2" fill="{fill}"/>"""

PIECES = {
    # Король: сидит на троне, высокая зубчатая корона с крестом, меч поперёк колен.
    "K": THRONE + """
  <path d="M15 37 V27 Q15 22 22.5 22 Q30 22 30 27 V37 Z" fill="{fill}"/>
  <circle cx="22.5" cy="16.5" r="4.6" fill="{fill}"/>
  <path d="M16.5 13 L17.5 5.5 L20 9 L22.5 4 L25 9 L27.5 5.5 L28.5 13 Z" fill="{shade}"/>
  <path d="M22.5 0.8 V4.2 M20.8 2.3 H24.2" stroke-width="1.6" stroke-linecap="round" fill="none"/>
  <path d="M20.3 16.8 h1 M23.7 16.8 h1 M21.5 19.2 h2" stroke-width="0.9"/>
  <path d="M13.5 33.5 L32 28" stroke-width="2.4" stroke-linecap="round"/>
  <path d="M16.6 31.4 l1.6 3.6" stroke-width="1.8" stroke-linecap="round"/>""" + BASE,
    # Королева: на троне, покрывало до плеч, корона-обруч с шариками, ладонь у щеки.
    "Q": THRONE + """
  <path d="M15 37 V27 Q15 22 22.5 22 Q30 22 30 27 V37 Z" fill="{fill}"/>
  <path d="M15.8 24 Q15 12 22.5 10.5 Q30 12 29.2 24 Z" fill="{shade}"/>
  <circle cx="22.5" cy="16.8" r="4.4" fill="{fill}"/>
  <path d="M17.5 12.5 H27.5 L26.5 9.5 H18.5 Z" fill="{shade}"/>
  <circle cx="18.5" cy="7.6" r="1.5" fill="{fill}"/><circle cx="22.5" cy="6.6" r="1.5" fill="{fill}"/>
  <circle cx="26.5" cy="7.6" r="1.5" fill="{fill}"/>
  <path d="M20.3 17 h1 M23.7 17 h1 M21.5 19.4 h2" stroke-width="0.9"/>
  <path d="M27.8 31 Q29 25 26.4 20.6" stroke-width="1.7" fill="none" stroke-linecap="round"/>
  <circle cx="26.2" cy="20.2" r="1.8" fill="{fill}"/>""" + BASE,
    # Епископ: стоит, длинное облачение, высокая митра с прорезью, посох с завитком.
    "B": """
  <path d="M12.5 39 L15.5 24 Q16.5 21 22.5 21 Q28.5 21 29.5 24 L32.5 39 Z" fill="{fill}"/>
  <path d="M22.5 22 V38" stroke-width="1" opacity="0.6"/>
  <circle cx="22.5" cy="16" r="4.4" fill="{fill}"/>
  <path d="M17.6 12.6 L19 2.5 L22.5 7.5 L26 2.5 L27.4 12.6 Z" fill="{shade}"/>
  <path d="M22.5 7.5 V12.6" stroke-width="1"/>
  <path d="M20.3 16.3 h1 M23.7 16.3 h1 M21.5 18.7 h2" stroke-width="0.9"/>
  <path d="M34 39 V11 Q34 5.5 38.5 6 Q41.5 7 40.2 10 Q39 12 36.8 10.6" stroke-width="2" fill="none" stroke-linecap="round"/>
  <path d="M17.5 30 V25 M19.3 30 V24.5 M21.1 30 V25" stroke-width="1.3" stroke-linecap="round"/>""" + BASE,
    # Конь: голова и шея коня влево, за ней всадник в шлеме со щитом.
    "N": """
  <path d="M11 39 V32 Q11 26.5 15.5 23.5 L18.5 21.5 Q13.5 21.5 10.5 19.5 Q8.5 18 9.5 15.5 L14 9.5 Q15 7.5 17.5 7.2
           L19 4.2 L21 7.6 Q27 9 29.5 15.5 Q32 22 31 30 L30.5 39 Z" fill="{fill}"/>
  <circle cx="16.5" cy="12" r="1" fill="{line}"/>
  <path d="M10.6 17.2 Q12 18 13.2 17.2" stroke-width="1" fill="none"/>
  <path d="M21.5 8.5 Q26.5 11 27.5 17.5 Q28.5 23 27.5 29" stroke-width="1" fill="none" opacity="0.7"/>
  <path d="M30.5 9.5 Q34 6.5 37.5 9.5 L37 13.5 H31 Z" fill="{shade}"/>
  <circle cx="34.2" cy="15.6" r="3" fill="{fill}"/>
  <path d="M29.5 19 H38.5 V26 Q34 31 29.5 26 Z" fill="{shade}"/>
  <path d="M34 19.5 V28.6 M30 22.4 H38" stroke-width="0.9"/>""" + BASE,
    # Ладья: пеший воин — конический шлем с наносником, длинный щит в обеих руках.
    "R": """
  <path d="M13.5 39 V26 Q13.5 19.5 22.5 19.5 Q31.5 19.5 31.5 26 V39 Z" fill="{fill}"/>
  <path d="M17 13.5 L22.5 3 L28 13.5 Z" fill="{shade}"/>
  <circle cx="22.5" cy="15.6" r="4.4" fill="{fill}"/>
  <path d="M17 13.6 H28 M22.5 13.6 V17" stroke-width="1.3"/>
  <path d="M20.2 16 h1 M23.8 16 h1 M21.2 18.4 h2.6" stroke-width="0.9"/>
  <path d="M15 21 H30 V31.5 Q22.5 40 15 31.5 Z" fill="{shade}"/>
  <path d="M22.5 21.5 V36 M15.5 25.5 H29.5" stroke-width="1"/>
  <circle cx="22.5" cy="25.5" r="1.6" fill="{fill}"/>""" + BASE,
    # Пешка: гранёный камень-столбик с поясом.
    "P": """
  <path d="M14.5 39 L16 17.5 Q16.5 12.5 22.5 11.5 Q28.5 12.5 29 17.5 L30.5 39 Z" fill="{fill}"/>
  <path d="M19.5 13.5 L19 39 M25.5 13.5 L26 39" stroke-width="0.9" opacity="0.55"/>
  <path d="M15.8 22 Q22.5 24.5 29.2 22" stroke-width="1.3" fill="none"/>
  <rect x="11.5" y="38" width="22" height="4" rx="1.2" fill="{fill}"/>""",
}

TEMPLATE = """<svg xmlns="http://www.w3.org/2000/svg" width="45" height="45" viewBox="4 0 37.5 43">
  <!-- Набор «Льюис» по мотивам льюисских шахмат XII века: собственная работа проекта michess, CC0. -->
  <g stroke="{line}" stroke-width="1.5" stroke-linejoin="round">{body}
  </g>
</svg>
"""


def main() -> None:
    """Генерирует SVG-файлы фигур собственного набора «Льюис» для обоих цветов."""
    OUT.mkdir(parents=True, exist_ok=True)
    for color, palette in COLORS.items():
        for piece, body in PIECES.items():
            svg = TEMPLATE.format(body=body.format(**palette), **palette)
            (OUT / f"{color}{piece}.svg").write_text(svg, encoding="utf-8")
    print(f"[+] {OUT}: {len(COLORS) * len(PIECES)} SVG")


if __name__ == "__main__":
    main()
