# --- FILE: src/services/bots/guests.py ---
"""
Мастера прошлого — участники знаменитых турниров («Машина времени», таск 28.2).

Игроку нужен полный исторический состав, а не только самые известные имена: в Лондоне 1851 играли шестнадцать
человек, в Гастингсе 1895 — двадцать два. Каждый участник здесь — соперник с характером мастерской
(BotPersonalityConfig): стиль — по известной манере игры, сила — по историческим оценкам относительно уже
откалиброванных мастеров (bots/masters.py: Стаунтон 2000, Андерсен 2100, Ласкер 2250, Капабланка 2300). В турнире
участник сохраняется как персоналия с ключом «guest:<id>»: симуляция и партия игрока работают как с любым
соперником мастерской, а имя на языке игрока берёт клиент (bots.guests.<id>).

Все — умершие шахматисты (правило 1). Годы жизни сверены с открытыми источниками (17.11); у кого надёжных дат
нет — не указаны. Портретов и своих дебютных книг у мастеров прошлого пока нет: это следующий шаг.
"""

from dataclasses import dataclass

from src.services.bots.personality import BotPersonalityConfig

GUEST_PREFIX = "guest:"


@dataclass(frozen=True)
class Guest:
    id: str
    # Латинское имя для PGN и архива: «Фамилия, Имя».
    pgn_name: str
    # Годы жизни — только сверенные с источниками; None — надёжных дат найти не удалось (трое малоизвестных
    # участников Лондона 1851).
    era: str | None
    rating: int
    config: BotPersonalityConfig

    @property
    def key(self) -> str:
        return f"{GUEST_PREFIX}{self.id}"


def _guest(guest_id: str, pgn_name: str, era: str | None, rating: int, **style) -> Guest:
    return Guest(guest_id, pgn_name, era, rating, BotPersonalityConfig(target_elo=rating, **style))


GUESTS: tuple[Guest, ...] = (
    # --- Лондон 1851: первый международный турнир -------------------------------------------------------------
    # Королевский гамбит и атака без оглядки на материал.
    _guest("kieseritzky", "Kieseritzky, Lionel", "1806–1853", 1950, aggression=80, mobility=150, king_safety=70,
           randomness=30, opening_style="gambit", draw_attitude=-50),
    # Мастер пешечных окончаний, осторожная игра.
    _guest("szen", "Szen, Jozsef", "1805–1857", 1950, aggression=-30, pawn_structure=160, passed_pawns=170,
           king_safety=130, randomness=15),
    # Теоретик дебютов, упорная защита.
    _guest("lowenthal", "Loewenthal, Johann", "1810–1876", 1950, aggression=-10, center_control=140, king_safety=130,
           randomness=20),
    # Автор этюдов: комбинации и точный эндшпиль.
    _guest("horwitz", "Horwitz, Bernhard", "1807–1885", 1900, aggression=40, mobility=140, passed_pawns=140,
           randomness=25),
    # Медленная закрытая игра на изматывание.
    _guest("williams", "Williams, Elijah", "1809–1854", 1900, aggression=-50, king_safety=160, pawn_structure=150,
           randomness=20, draw_attitude=20),
    # Позиционная игра, английское начало.
    _guest("wyvill", "Wyvill, Marmaduke", "1815–1896", 1900, aggression=-20, pawn_structure=160, center_control=130,
           randomness=20),
    # Необычные дебюты, риск и выдумка.
    _guest("bird", "Bird, Henry Edward", "1829–1908", 1950, aggression=70, mobility=150, king_safety=70,
           randomness=35, draw_attitude=-60),
    _guest("mayet", "Mayet, Carl", "1810–1868", 1800, aggression=40, mobility=130, randomness=35),
    _guest("kennedy_h", "Kennedy, Hugh Alexander", "1809–1878", 1800, aggression=20, mobility=120, randomness=35),
    _guest("lowe", "Loewe, Edward", "1794–1880", 1750, aggression=-10, king_safety=120, randomness=40),
    _guest("newham", "Newham, Samuel", None, 1700, aggression=0, randomness=40),
    _guest("kennedy_e", "Kennedy, Edward Shirley", "1817–1898", 1650, aggression=10, randomness=45),
    _guest("brodie", "Brodie, Alfred", None, 1650, aggression=0, randomness=45),
    _guest("mucklow", "Mucklow, James R.", None, 1600, aggression=0, randomness=50, habits=["pawn_grabber"]),

    # --- Гастингс 1895 ------------------------------------------------------------------------------------------
    # Безупречная защита, ничья как оружие.
    _guest("schlechter", "Schlechter, Carl", "1874–1918", 2200, aggression=-20, king_safety=160, pawn_structure=150,
           randomness=8, blunder_guard_cp=70, draw_attitude=50),
    # Позиционный нажим и открытые линии.
    _guest("teichmann", "Teichmann, Richard", "1868–1925", 2150, aggression=10, mobility=150, center_control=140,
           randomness=12, draw_attitude=20),
    # Два слона и атака, ничьих не признаёт.
    _guest("janowski", "Janowski, David", "1868–1927", 2150, aggression=90, mobility=170, king_safety=60,
           randomness=25, draw_attitude=-90),
    # Тактик и мастер эндшпиля.
    _guest("blackburne", "Blackburne, Joseph Henry", "1841–1924", 2100, aggression=70, mobility=150, passed_pawns=130,
           randomness=20, draw_attitude=-40),
    # Упорная оборона.
    _guest("burn", "Burn, Amos", "1848–1925", 2100, aggression=-50, king_safety=170, pawn_structure=150, randomness=12),
    # Атакующая школа, учитель русских мастеров.
    _guest("schiffers", "Schiffers, Emanuel", "1850–1904", 2050, aggression=50, mobility=140, randomness=20),
    # Знаток дебютов, осторожная игра.
    _guest("bardeleben", "Bardeleben, Curt von", "1861–1924", 2050, aggression=-20, center_control=150,
           pawn_structure=140, randomness=15, draw_attitude=30),
    # Спокойная позиционная игра.
    _guest("mason", "Mason, James", "1849–1905", 2050, aggression=-20, pawn_structure=150, king_safety=130,
           randomness=20),
    # Практик, хитрая защита.
    _guest("gunsberg", "Gunsberg, Isidor", "1854–1930", 2050, aggression=20, mobility=130, king_safety=120,
           randomness=20),
    # Гамбиты и острая игра.
    _guest("mieses", "Mieses, Jacques", "1865–1954", 2050, aggression=90, mobility=160, king_safety=60,
           randomness=30, opening_style="gambit", draw_attitude=-70),
    _guest("walbrodt", "Walbrodt, Carl August", "1871–1902", 2000, aggression=20, mobility=130, randomness=25),
    # Аналитик: порядок и точность.
    _guest("marco", "Marco, Georg", "1863–1923", 2000, aggression=-20, pawn_structure=140, king_safety=130,
           randomness=20, draw_attitude=20),
    # Контргамбит и смелые жертвы.
    _guest("albin", "Albin, Adolf", "1848–1920", 1950, aggression=70, mobility=140, randomness=30,
           opening_style="gambit"),
    _guest("pollock", "Pollock, William Henry Krause", "1859–1896", 1900, aggression=70, mobility=140, king_safety=70,
           randomness=35, draw_attitude=-40),
    _guest("tinsley", "Tinsley, Samuel", "1847–1903", 1850, aggression=10, randomness=35),
    _guest("vergani", "Vergani, Beniamino", "1863–1927", 1700, aggression=0, randomness=45),

    # --- Санкт-Петербург 1914 ------------------------------------------------------------------------------------
    # Находчивость и расчёт.
    _guest("bernstein", "Bernstein, Ossip", "1882–1962", 2200, aggression=40, mobility=150, center_control=130,
           randomness=15),

    # --- Нью-Йорк 1924 -------------------------------------------------------------------------------------------
    # Защита и ферзевые окончания.
    _guest("maroczy", "Maroczy, Geza", "1870–1951", 2250, aggression=-40, king_safety=170, pawn_structure=160,
           randomness=8, blunder_guard_cp=70, draw_attitude=30),
    # Оптимизм и инициатива.
    _guest("bogoljubow", "Bogoljubow, Efim", "1889–1952", 2250, aggression=60, mobility=160, center_control=140,
           randomness=20, draw_attitude=-50),
    # Опасный атакующий игрок.
    _guest("yates", "Yates, Frederick Dewhurst", "1884–1932", 2050, aggression=70, mobility=150, king_safety=70,
           randomness=25, draw_attitude=-40),
    _guest("lasker_edward", "Lasker, Edward", "1885–1981", 2050, aggression=30, mobility=140, randomness=20),

    # --- АВРО 1938 -----------------------------------------------------------------------------------------------
    # Универсал: атака и точная техника.
    _guest("keres", "Keres, Paul", "1916–1975", 2400, aggression=60, mobility=170, center_control=140, randomness=10,
           blunder_guard_cp=60, draw_attitude=-30),
    # Ясный план и техника.
    _guest("fine", "Fine, Reuben", "1914–1993", 2400, aggression=0, mobility=150, pawn_structure=150, randomness=8,
           blunder_guard_cp=60),
    # Логика и расчёт.
    _guest("euwe", "Euwe, Max", "1901–1981", 2350, aggression=30, center_control=150, mobility=150, randomness=15),
    # Цепкая защита и выносливость в трудных позициях.
    _guest("reshevsky", "Reshevsky, Samuel", "1911–1992", 2400, aggression=-10, king_safety=160, pawn_structure=150,
           randomness=10, blunder_guard_cp=60, draw_attitude=-20),
    # Позиционная игра и эндшпиль.
    _guest("flohr", "Flohr, Salo", "1908–1983", 2350, aggression=-40, pawn_structure=170, passed_pawns=150,
           king_safety=140, randomness=8, blunder_guard_cp=60, draw_attitude=40),

    # --- Вторая партия турниров (28.4): Баден-Баден 1870, Лондон 1883, Сан-Себастьян 1911, Нью-Йорк 1927, Ноттингем 1936 ---
    # Классическая ясная игра.
    _guest("neumann", "Neumann, Gustav", "1838–1881", 2050, aggression=10, center_control=140, randomness=15),
    # Природный талант, лёгкая фигурная игра.
    _guest("de_vere", "De Vere, Cecil Valentine", "1846–1875", 1950, aggression=0, mobility=140, randomness=25),
    # Находчивость в атаке и в эндшпиле.
    _guest("winawer", "Winawer, Szymon", "1838–1919", 2100, aggression=50, mobility=150, randomness=25),
    # Открытая игра.
    _guest("rosenthal", "Rosenthal, Samuel", "1837–1902", 2000, aggression=30, mobility=130, randomness=25),
    _guest("minckwitz", "Minckwitz, Johannes", "1843–1901", 1950, aggression=20, randomness=30),
    # Атака на короля.
    _guest("mackenzie", "Mackenzie, George Henry", "1837–1891", 2100,
           aggression=70, mobility=150, king_safety=80, randomness=20, draw_attitude=-40),
    # Прочность: его очень трудно обыграть.
    _guest("englisch", "Englisch, Berthold", "1851–1897", 2050,
           aggression=-40, king_safety=160, pawn_structure=140, randomness=12, draw_attitude=60),
    _guest("noa", "Noa, Josef", "1856–1903", 1900, aggression=0, randomness=35),
    _guest("sellman", "Sellman, Alexander", "1856–1888", 1850, aggression=10, randomness=35),
    _guest("mortimer", "Mortimer, James", "1832–1911", 1750, aggression=20, randomness=45),
    _guest("skipworth", "Skipworth, Arthur", "1830–1898", 1750, aggression=0, randomness=45),
    # Прочная позиционная игра.
    _guest("vidmar", "Vidmar, Milan", "1885–1962", 2250,
           aggression=-10, pawn_structure=150, center_control=140, randomness=10),
    # Атака и жертва.
    _guest("spielmann", "Spielmann, Rudolf", "1883–1942", 2250,
           aggression=90, mobility=160, king_safety=60, randomness=20, opening_style="gambit", draw_attitude=-50),
    # Находчивый боец, автор этюдов.
    _guest("duras", "Duras, Oldrich", "1882–1957", 2200, aggression=50, mobility=150, passed_pawns=130, randomness=20),
    # Теоретик дебютов.
    _guest("leonhardt", "Leonhardt, Paul Saladin", "1877–1934", 2100, aggression=40, center_control=140, randomness=25),
    _guest("tylor", "Tylor, Theodore", "1900–1968", 2050, aggression=-10, king_safety=130, randomness=20),
    # Атакующий стиль.
    _guest("alexander", "Alexander, Conel Hugh O'Donel", "1909–1974", 2150,
           aggression=70, mobility=150, randomness=20, draw_attitude=-40),
    _guest("thomas", "Thomas, George Alan", "1881–1972", 2100, aggression=-10, pawn_structure=140, randomness=20),
    _guest("winter", "Winter, William", "1897–1955", 2050, aggression=30, mobility=130, randomness=25),

    # --- Третья партия турниров (28.4): Вена 1882, Нюрнберг 1896, Лондон 1899, Монте-Карло 1903 ------------------
    _guest("wittek", "Wittek, Alexander", "1852–1894", 2050, aggression=30, mobility=130, randomness=25),
    # Осторожная позиционная игра.
    _guest("weiss", "Weiss, Max", "1857–1927", 2100,
           aggression=-30, king_safety=150, pawn_structure=150, randomness=12, draw_attitude=40),
    _guest("hruby", "Hruby, Vincenz", "1856–1917", 2000, aggression=10, randomness=25),
    _guest("schwarz", "Schwarz, Adolf", "1836–1910", 2000, aggression=-20, king_safety=140, randomness=20),
    _guest("meitner", "Meitner, Philipp", "1839–1910", 1950, aggression=20, randomness=30),
    # Причудливые дебюты.
    _guest("ware", "Ware, Preston", "1821–1890", 1850, aggression=10, randomness=40),
    _guest("fleissig", "Fleissig, Bernhard", "1853–1931", 1900, aggression=0, randomness=30),
    # Яркий атакующий талант, гамбиты.
    _guest("charousek", "Charousek, Rudolf", "1873–1900", 2200,
           aggression=80, mobility=160, randomness=20, opening_style="gambit", draw_attitude=-50),
    _guest("showalter", "Showalter, Jackson Whipps", "1859–1935", 2100, aggression=50, mobility=140, randomness=25),
    _guest("porges", "Porges, Moritz", "1857–1909", 2000, aggression=0, center_control=130, randomness=25),
    # Живая атакующая игра.
    _guest("schallopp", "Schallopp, Emil", "1843–1919", 2000, aggression=60, mobility=140, randomness=30),
    _guest("cohn", "Cohn, Wilhelm", "1859–1913", 2050, aggression=10, randomness=25),
    _guest("lee", "Lee, Francis Joseph", "1858–1909", 1950, aggression=-10, king_safety=130, randomness=25),
    # Прочная игра.
    _guest("wolf", "Wolf, Heinrich", "1875–1943", 2100,
           aggression=-20, king_safety=140, randomness=15, draw_attitude=40),
    _guest("taubenhaus", "Taubenhaus, Jean", "1850–1919", 2000, aggression=20, randomness=30),
    _guest("reggio", "Reggio, Arturo", "1863–1917", 1900, aggression=0, randomness=35),
    # Проиграл в Монте-Карло 1903 все 26 партий.
    _guest("moreau", "Moreau, Charles", "1837–1916", 1500, aggression=0, randomness=60, habits=["hangs_pieces"]),
)
GUESTS_BY_ID = {guest.id: guest for guest in GUESTS}
