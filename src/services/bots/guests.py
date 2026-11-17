# --- FILE: src/services/bots/guests.py ---
"""
Мастера прошлого — участники знаменитых турниров («Машина времени», таск 28.2).

Игроку нужен полный исторический состав, а не только самые известные имена: в Лондоне 1851 играли шестнадцать
человек, в Гастингсе 1895 — двадцать два. Каждый участник здесь — соперник с характером мастерской
(BotPersonalityConfig): стиль — по известной манере игры, сила — по историческим оценкам относительно уже
откалиброванных мастеров (bots/masters.py: Стаунтон 2000, Андерсен 2100, Ласкер 2250, Капабланка 2300). В турнире
участник сохраняется как персоналия с ключом «guest:<id>»: симуляция и партия игрока работают как с любым
соперником мастерской, а имя на языке игрока берёт клиент (bots.guests.<id>). У кого за историю закрепился свой
дебют — играет его (SIGNATURE_OPENINGS): Винавер — вариант Винавера, Грюнфельд — защиту Грюнфельда, Бёрд — дебют Бёрда.

Все — умершие шахматисты (правило 1). Годы жизни сверены с открытыми источниками (17.11); у кого надёжных дат
нет — не указаны. Портретов и своих дебютных книг у мастеров прошлого пока нет: это следующий шаг.
"""

from dataclasses import dataclass

from src.services import openings
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


QGD = "Queen's Gambit Declined"
RUY_LOPEZ = "Ruy Lopez"
KINGS_GAMBIT = "King's Gambit Accepted"
VIENNA = "Vienna Game"
FRENCH = "French Defense"

# Фирменные дебюты мастеров: (белыми, чёрными), до трёх на цвет. Названия — из открытой таблицы дебютов
# (src/services/openings.py); только то, что за мастером закрепила история: дебют его имени или его постоянное
# оружие. В партии мастер идёт в эти линии, когда соперник это позволяет, и называет дебют в реплике.
SIGNATURE_OPENINGS: dict[str, tuple[tuple[str, ...], tuple[str, ...]]] = {
    "kieseritzky": (("King's Gambit Accepted: Kieseritzky Gambit",), (KINGS_GAMBIT,)),
    "bird": (("Bird Opening",), ()),
    "wyvill": (("English Opening",), ()),
    "winawer": ((), ("French Defense: Winawer Variation",)),
    "albin": ((), ("Queen's Gambit Declined: Albin Countergambit",)),
    "alapin": (("Sicilian Defense: Alapin Variation",), ()),
    "grunfeld": ((QGD,), ("Grünfeld Defense",)),
    "pirc": ((), ("Pirc Defense",)),
    "caro": ((), ("Caro-Kann Defense",)),
    "colle": (("Queen's Pawn Game: Colle System",), ()),
    "samisch": (("Nimzo-Indian Defense: Sämisch Variation", "King's Indian Defense: Sämisch Variation"), ()),
    "torre": (("Queen's Pawn Game: Torre Attack",), ()),
    "ware": (("Ware Opening",), ("Dutch Defense: Stonewall Variation",)),
    "mieses": ((VIENNA, "Danish Gambit", "Center Game"), ()),
    "spielmann": ((VIENNA, KINGS_GAMBIT), ()),
    "charousek": ((KINGS_GAMBIT,), ()),
    "schlechter": ((RUY_LOPEZ,), ("Slav Defense",)),
    "maroczy": ((RUY_LOPEZ,), (FRENCH,)),
    "burn": ((), (FRENCH,)),
    "carls": (("English Opening",), ()),
    "blackburne": (("Scotch Game",), ()),
    "janowski": ((QGD,), ()),
    "bogoljubow": ((QGD,), ("Bogo-Indian Defense",)),
    "euwe": ((QGD,), ("Ruy Lopez: Open",)),
    "flohr": ((QGD,), ("Caro-Kann Defense",)),
    "fine": ((QGD,), ()),
    "reshevsky": ((QGD,), ("Nimzo-Indian Defense",)),
    "vidmar": ((QGD,), ("Queen's Gambit Declined: Orthodox Defense",)),
    "keres": ((RUY_LOPEZ,), ()),
    "kashdan": ((RUY_LOPEZ,), ()),
    "duras": ((RUY_LOPEZ,), ()),
    "teichmann": ((RUY_LOPEZ,), ("Queen's Gambit Declined: Orthodox Defense",)),
    "showalter": ((RUY_LOPEZ,), ()),
    "thomas": ((RUY_LOPEZ,), ()),
    "yates": ((RUY_LOPEZ,), ("King's Indian Defense",)),
    "canal": (("Italian Game: Giuoco Piano",), ()),
    "menchik": ((QGD,), (FRENCH,)),
    "becker": ((QGD,), ()),
    "alexander": ((), ("Dutch Defense",)),
    "dus_chotimirsky": ((QGD,), ()),
    "owen": ((), ("Owen Defense",)),
    "from": (("Danish Gambit",), ("Bird Opening: From's Gambit",)),
}


def opening_position(name: str) -> str:
    """Позиция (EPD) дебюта по названию из открытой таблицы: самая короткая линия с таким названием."""
    found = [line for line in openings.lines().values() if line.name == name]
    if not found:
        raise KeyError(f"no opening named {name!r} in the table")
    return min(found, key=lambda line: len(line.moves)).epd


def _guest(guest_id: str, pgn_name: str, era: str | None, rating: int, **style) -> Guest:
    white, black = SIGNATURE_OPENINGS.get(guest_id, ((), ()))
    config = BotPersonalityConfig(
        target_elo=rating, openings_white=[opening_position(name) for name in white],
        openings_black=[opening_position(name) for name in black], **style,
    )
    return Guest(guest_id, pgn_name, era, rating, config)


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

    # --- Четвёртая партия турниров (28.4): Карлсбад 1907, Москва 1925, Карлсбад 1929, Блед 1931 ------------------
    # Прочная позиционная игра.
    _guest("salwe", "Salwe, Georg", "1862–1920", 2150, aggression=-10, pawn_structure=140, randomness=15),
    # Атака и риск.
    _guest("dus_chotimirsky", "Dus-Chotimirsky, Fyodor", "1881–1965", 2050, aggression=60, mobility=150, randomness=30),
    # Теоретик эндшпиля.
    _guest("berger", "Berger, Johann", "1845–1933", 2050,
           aggression=-30, pawn_structure=150, passed_pawns=160, randomness=15, draw_attitude=40),
    _guest("olland", "Olland, Adolf", "1867–1933", 1950, aggression=10, randomness=25),
    _guest("cohn_erich", "Cohn, Erich", "1884–1918", 2050, aggression=30, randomness=25),
    _guest("johner_paul", "Johner, Paul", "1887–1938", 2100, aggression=10, mobility=130, randomness=20),
    # Острая тактическая игра.
    _guest("torre", "Torre Repetto, Carlos", "1904–1978", 2250, aggression=50, mobility=160, randomness=20),
    _guest("romanovsky", "Romanovsky, Peter", "1892–1964", 2200, aggression=40, mobility=150, randomness=20),
    # Знаток дебютов, осторожная игра.
    _guest("grunfeld", "Gruenfeld, Ernst", "1893–1962", 2250,
           aggression=-30, center_control=140, pawn_structure=150, randomness=10, draw_attitude=40),
    _guest("ilyin_zhenevsky", "Ilyin-Zhenevsky, Alexander", "1894–1941", 2150, aggression=30, randomness=25),
    _guest("bohatyrchuk", "Bohatyrchuk, Fedir", "1892–1984", 2250, aggression=20, center_control=140, randomness=15),
    _guest("verlinsky", "Verlinsky, Boris", "1888–1950", 2200, aggression=50, mobility=150, randomness=25),
    _guest("levenfish", "Levenfish, Grigory", "1889–1961", 2300,
           aggression=30, mobility=150, center_control=130, randomness=15),
    _guest("rabinovich", "Rabinovich, Ilya", "1891–1942", 2200, aggression=-10, pawn_structure=150, randomness=15),
    _guest("samisch", "Saemisch, Friedrich", "1896–1975", 2200, aggression=20, center_control=140, randomness=20),
    _guest("gotthilf", "Gotthilf, Solomon", "1903–1967", 2100, aggression=0, randomness=25),
    _guest("zubarev", "Zubarev, Nikolai", "1894–1951", 2100, aggression=10, randomness=25),
    _guest("becker", "Becker, Albert", "1896–1984", 2200,
           aggression=-20, pawn_structure=140, randomness=15, draw_attitude=30),
    # Комбинационная игра.
    _guest("canal", "Canal, Esteban", "1896–1981", 2200, aggression=60, mobility=150, randomness=25),
    # Автор этюдов, сильный эндшпиль.
    _guest("mattison", "Matisons, Hermanis", "1894–1932", 2200,
           aggression=0, passed_pawns=150, pawn_structure=140, randomness=15),
    # Атака по своей системе.
    _guest("colle", "Colle, Edgard", "1897–1932", 2200, aggression=50, mobility=140, king_safety=90, randomness=20),
    _guest("treybal", "Treybal, Karel", "1885–1941", 2150, aggression=40, randomness=25),
    _guest("gilg", "Gilg, Karl", "1901–1981", 2150, aggression=10, randomness=25),
    # Первая чемпионка мира; позиционный стиль.
    _guest("menchik", "Menchik, Vera", "1906–1944", 2050,
           aggression=-10, pawn_structure=140, king_safety=130, randomness=20),
    # Техника и эндшпиль.
    _guest("kashdan", "Kashdan, Isaac", "1905–1985", 2350,
           aggression=10, mobility=150, pawn_structure=140, randomness=10),
    _guest("stoltz", "Stoltz, Goesta", "1904–1963", 2250, aggression=60, mobility=150, randomness=20),
    _guest("kostic", "Kostic, Boris", "1887–1963", 2200, aggression=30, mobility=140, randomness=20),
    _guest("asztalos", "Asztalos, Lajos", "1889–1956", 2150, aggression=0, randomness=20),
    _guest("pirc", "Pirc, Vasja", "1907–1980", 2250, aggression=10, center_control=120, mobility=140, randomness=15),

    # --- Пятая партия турниров (28.4): Нью-Йорк 1857, Париж 1878, Париж 1900, Петербург 1909 ---------------------
    _guest("stanley", "Stanley, Charles Henry", "1819–1901", 1900, aggression=20, mobility=130, randomness=30),
    _guest("lichtenhein", "Lichtenhein, Theodor", "1829–1874", 1900, aggression=30, mobility=130, randomness=30),
    _guest("marache", "Marache, Napoleon", "1818–1875", 1850, aggression=40, mobility=130, randomness=35),
    _guest("raphael", "Raphael, Benjamin", "1818–1880", 1800, aggression=10, randomness=35),
    _guest("perrin", "Perrin, Frederick", "1815–1889", 1800, aggression=0, randomness=35),
    _guest("thompson", "Thompson, James", "1804–1870", 1800, aggression=30, randomness=35),
    _guest("montgomery", "Montgomery, Hardman Philips", None, 1800, aggression=10, randomness=35),
    _guest("meek", "Meek, Alexander Beaufort", "1814–1865", 1750, aggression=20, randomness=40),
    _guest("fuller", "Fuller, William James Appleton", None, 1750, aggression=10, randomness=40),
    # Организатор конгресса.
    _guest("fiske", "Fiske, Daniel Willard", "1831–1904", 1700, aggression=0, randomness=40),
    _guest("calthrop", "Calthrop, Samuel Robert", None, 1700, aggression=0, randomness=40),
    _guest("kennicott", "Kennicott, Hiram", None, 1700, aggression=10, randomness=40),
    _guest("knott", "Knott, Hubert", None, 1700, aggression=0, randomness=40),
    _guest("allison", "Allison, William", None, 1650, aggression=0, randomness=45),
    _guest("clerc", "Clerc, Albert", "1830–1918", 1950, aggression=10, randomness=30),
    _guest("pitschel", "Pitschel, Karl", "1829–1883", 1800, aggression=0, randomness=40),
    _guest("gifford", "Gifford, H. W. B.", "1847–1924", 1750, aggression=0, randomness=45),
    _guest("brody", "Brody, Miklos", "1877–1949", 2000, aggression=10, randomness=30),
    _guest("rosen", "Rosen, Leon", "1869–1942", 1800, aggression=0, randomness=40),
    _guest("sterling", "Marquez Sterling, Manuel", "1872–1934", 1700, aggression=10, randomness=45),
    _guest("didier", "Didier, M.", None, 1650, aggression=0, randomness=45),
    _guest("perlis", "Perlis, Julius", "1880–1913", 2150, aggression=20, mobility=140, randomness=20),
    _guest("forgacs", "Forgacs, Leo", "1881–1930", 2150, aggression=30, mobility=140, randomness=20),
    _guest("speijer", "Speijer, Abraham", "1873–1956", 2000, aggression=0, randomness=25),
    _guest("freymann", "Freymann, Sergey von", "1882–1946", 2050, aggression=10, randomness=25),
    _guest("znosko_borovsky", "Znosko-Borovsky, Eugene", "1884–1954", 2100, aggression=30, mobility=140, randomness=25),

    # --- Шестая партия турниров (28.4): Вена 1898, Карлсбад 1911, Мангейм 1914, Карлсбад 1923 --------------------
    _guest("lipke", "Lipke, Paul", "1870–1955", 2100, aggression=20, mobility=130, randomness=20),
    # Теоретик дебютов.
    _guest("alapin", "Alapin, Simon", "1856–1923", 2100, aggression=20, center_control=130, randomness=25),
    _guest("halprin", "Halprin, Alexander", "1868–1921", 2000, aggression=50, randomness=30),
    _guest("caro", "Caro, Horatio", "1862–1920", 2000, aggression=10, randomness=25),
    _guest("baird", "Baird, David Graham", "1854–1913", 1850, aggression=0, randomness=35),
    _guest("trenchard", "Trenchard, Herbert William", "1857–1934", 1800, aggression=0, randomness=40),
    _guest("rotlewi", "Rotlewi, Gersz", "1889–1920", 2200, aggression=40, mobility=150, randomness=20),
    _guest("suchting", "Suechting, Hugo", "1874–1916", 2050, aggression=-20, king_safety=140, randomness=20),
    _guest("rabinovich_abram", "Rabinovich, Abram", "1878–1943", 2050, aggression=30, randomness=25),
    _guest("chajes", "Chajes, Oscar", "1873–1928", 2050, aggression=40, randomness=25),
    _guest("fahrni", "Fahrni, Hans", "1874–1939", 2050, aggression=10, randomness=25),
    _guest("jaffe", "Jaffe, Charles", "1879–1941", 2050, aggression=30, randomness=30),
    # Один из зачинателей гипермодернизма.
    _guest("breyer", "Breyer, Gyula", "1893–1921", 2200,
           aggression=30, center_control=120, mobility=150, randomness=20),
    _guest("john", "John, Walter", "1879–1940", 2050, aggression=0, randomness=25),
    _guest("post", "Post, Ehrhardt", "1881–1947", 2100, aggression=10, randomness=20),
    _guest("carls", "Carls, Carl", "1880–1958", 2100, aggression=-10, center_control=130, randomness=20),
    _guest("kruger", "Krueger, Paul", "1871–1939", 2000, aggression=0, randomness=30),
    _guest("flamberg", "Flamberg, Alexander", "1880–1926", 2100, aggression=30, randomness=25),
    _guest("bernstein_jacob", "Bernstein, Jacob", "1885–1959", 2000, aggression=10, randomness=25),

    # --- Седьмая партия турниров (28.4): Лондон 1862, Париж 1867 -------------------------------------------------
    _guest("owen", "Owen, John", "1827–1901", 1950, aggression=0, pawn_structure=130, randomness=30),
    _guest("macdonnell", "MacDonnell, George Alcock", "1830–1899", 1950, aggression=30, mobility=130, randomness=30),
    _guest("dubois", "Dubois, Serafino", "1817–1899", 2000, aggression=30, mobility=140, randomness=25),
    _guest("barnes", "Barnes, Thomas Wilson", "1825–1874", 1950, aggression=10, randomness=30),
    _guest("hannah", "Hannah, James", None, 1800, aggression=10, randomness=40),
    _guest("robey", "Robey, James", None, 1750, aggression=0, randomness=45),
    _guest("deacon", "Deacon, Frederick", "1829–1875", 1800, aggression=10, randomness=40),
    _guest("mongredien", "Mongredien, Augustus", "1807–1888", 1750, aggression=0, randomness=45),
    _guest("green", "Green, Valentine", None, 1750, aggression=0, randomness=45),
    # Комбинационный игрок.
    _guest("kolisch", "Kolisch, Ignatz von", "1837–1889", 2100,
           aggression=60, mobility=150, randomness=20, draw_attitude=-40),
    _guest("riviere", "Riviere, Jules Arnous de", "1830–1905", 1950, aggression=30, mobility=130, randomness=30),
    _guest("golmayo", "Golmayo Zupide, Celso", "1820–1898", 1900, aggression=20, randomness=30),
    _guest("czarnowski", "Czarnowski, Hieronim", "1834–1902", 1850, aggression=10, randomness=35),
    # Изобретатель головоломок; в практической игре рискован.
    _guest("loyd", "Loyd, Samuel", "1841–1911", 1850, aggression=40, mobility=130, randomness=40),
    _guest("dandre", "d'Andre, Emile", None, 1800, aggression=0, randomness=40),
    # Гамбитный стиль.
    _guest("from", "From, Martin Severin", "1828–1895", 1850,
           aggression=50, mobility=130, randomness=35, opening_style="gambit"),
    _guest("rousseau", "Rousseau, Eugene", "1805–1877", 1800, aggression=20, randomness=40),

    # --- Восьмая партия турниров (28.4): Берлин 1881 — Моравска-Острава 1923 -------------------------------------
    # Старший брат Луи Паульсена.
    _guest("paulsen_w", "Paulsen, Wilfried", "1828–1901", 1950, aggression=-10, king_safety=130, randomness=30),
    _guest("riemann", "Riemann, Fritz", "1859–1932", 2000, aggression=40, mobility=130, randomness=25),
    # Год рождения в источнике — «около 1845».
    _guest("wemmers", "Wemmers, Carl", "1845–1882", 1900, aggression=10, randomness=35),
    _guest("schmid", "Schmid, Carl Friedrich", "1840–1897", 1850, aggression=0, randomness=40),
    # Годы жизни неизвестны.
    _guest("schutz", "Schuetz, H. von", None, 1650, aggression=0, randomness=45),
    # Не путать с Адольфом Шварцем (schwarz).
    _guest("schwarz_jacques", "Schwarz, Jacques", "1856–1921", 1950, aggression=0, randomness=30),
    _guest("fox", "Fox, Albert Whiting", "1881–1964", 2000, aggression=50, mobility=140, randomness=30),
    # Годы жизни — по Викиданным (Q11727884).
    _guest("barry", "Barry, John Finan", "1873–1940", 2000, aggression=40, randomness=30),
    _guest("napier", "Napier, William Ewart", "1881–1952", 2050, aggression=50, mobility=140, randomness=25),
    # Годы жизни источником не подтверждены; в 1904 году ему было 33.
    _guest("lawrence", "Lawrence, Thomas", None, 1950, aggression=0, randomness=30),
    _guest("hodges", "Hodges, Albert Beauregard", "1861–1944", 2000, aggression=10, randomness=30),
    _guest("delmar", "Delmar, Eugene", "1841–1909", 1900, aggression=20, randomness=35),
    _guest("swiderski", "Swiderski, Rudolf", "1878–1909", 2100, aggression=30, mobility=130, randomness=25),
    # Автор этюдов.
    _guest("prokes", "Prokes, Ladislav", "1884–1966", 1950, aggression=10, passed_pawns=150, randomness=30),
    _guest("kvicala", "Kvicala, Jan", "1868–1939", 1900, aggression=0, randomness=35),
    # Не путать с Карелом Трейбалом (treybal).
    _guest("treybal_frantisek", "Treybal, Frantisek", "1882–1947", 2000, aggression=20, randomness=30),
    _guest("kohnlein", "Koehnlein, Friedrich", "1879–1916", 2000, aggression=20, randomness=30),
    # Автор этюдов.
    _guest("selezniev", "Selezniev, Alexey", "1888–1967", 2150,
           aggression=-10, passed_pawns=150, pawn_structure=130, randomness=20),
    _guest("pokorny", "Pokorny, Amos", "1890–1949", 2050, aggression=10, randomness=25),
    _guest("hromadka", "Hromadka, Karel", "1887–1956", 2050, aggression=50, mobility=140, randomness=30),
    _guest("walter", "Walter, Max", "1899–1940", 1950, aggression=10, randomness=30),
)
GUESTS_BY_ID = {guest.id: guest for guest in GUESTS}
