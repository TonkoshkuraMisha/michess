// --- FILE: frontend/src/config/champions.ts ---
// Исторические боты и легенды шахмат: здесь только данные (годы, рейтинг, изображения). Имена, титулы и девизы
// читаются из каталогов сообщений в момент обращения (геттеры), поэтому при смене языка они меняются без
// перезагрузки страницы.

import philidorAvatar from '../assets/champions/philidor.jpg';
import labourdonnaisAvatar from '../assets/champions/labourdonnais.jpg';
import stauntonAvatar from '../assets/champions/staunton.jpg';
import anderssenAvatar from '../assets/champions/anderssen.jpg';
import morphyAvatar from '../assets/champions/morphy.jpg';
import paulsenAvatar from '../assets/champions/paulsen.jpg';
import zukertortAvatar from '../assets/champions/zukertort.jpg';
import {t} from '../i18n';

export type HistoricalBotId =
    | 'philidor'
    | 'labourdonnais'
    | 'staunton'
    | 'anderssen'
    | 'morphy'
    | 'paulsen'
    | 'zukertort';

/** Исторический бот или соперник из мастерской (персоналия с ползунками). */
export type BotOpponentId = HistoricalBotId | 'custom';

export interface HistoricalBotProfile {
    id: BotOpponentId;
    name: string;
    shortName: string;
    playerLabel: string;
    title: string;
    era: string;
    rating: number;
    motto: string;
    avatar: string;
    fallbackAvatar: string;
}

function historicalBot(id: HistoricalBotId, era: string, rating: number, avatar: string): HistoricalBotProfile {
    return {
        id,
        era,
        rating,
        avatar,
        fallbackAvatar: `/assets/champions/${id}.jpg`,
        get name() {
            return t(`bots.profiles.${id}.name`);
        },
        get shortName() {
            return t(`bots.profiles.${id}.shortName`);
        },
        get playerLabel() {
            return t(`bots.profiles.${id}.playerLabel`);
        },
        get title() {
            return t(`bots.profiles.${id}.title`);
        },
        get motto() {
            return t(`bots.profiles.${id}.motto`);
        },
    };
}

export const HISTORICAL_BOTS: Record<HistoricalBotId, HistoricalBotProfile> = {
    philidor: historicalBot('philidor', '1749–1795', 1850, philidorAvatar),
    labourdonnais: historicalBot('labourdonnais', '1795–1840', 1950, labourdonnaisAvatar),
    staunton: historicalBot('staunton', '1810–1874', 2000, stauntonAvatar),
    anderssen: historicalBot('anderssen', '1818–1879', 2100, anderssenAvatar),
    morphy: historicalBot('morphy', '1837–1884', 2150, morphyAvatar),
    paulsen: historicalBot('paulsen', '1833–1891', 2080, paulsenAvatar),
    zukertort: historicalBot('zukertort', '1842–1888', 2120, zukertortAvatar),
};

export const HISTORICAL_BOTS_LIST: (HistoricalBotProfile & {id: HistoricalBotId})[] =
    Object.values(HISTORICAL_BOTS) as (HistoricalBotProfile & {id: HistoricalBotId})[];

export type ChampionId =
    | 'Steinitz' | 'Lasker' | 'Rubinstein' | 'Capablanca' | 'Alekhine' | 'Euwe' | 'Keres' | 'Botvinnik'
    | 'Geller' | 'Korchnoi' | 'Smyslov' | 'Tal' | 'Petrosian' | 'Spassky' | 'Fischer' | 'Karpov'
    | 'Kasparov' | 'Kramnik' | 'Anand' | 'Carlsen' | 'Ding';

export interface ChampionProfile {
    id: ChampionId;
    /** Чемпион мира — годы обладания титулом; иначе (Рубинштейн, Керес, Геллер, Корчной) — годы выступлений. */
    worldChampion: boolean;
    from: number;
    /** null — по сей день. */
    to: number | null;
    img: string;
    readonly name: string;
    readonly years: string;
}

function champion(id: ChampionId, worldChampion: boolean, from: number, to: number | null): ChampionProfile {
    return {
        id,
        worldChampion,
        from,
        to,
        img: `/assets/champions/${id}.jpg`,
        get name() {
            return t(`champions.names.${id}`);
        },
        get years() {
            return `${from}–${to ?? t('champions.present')}`;
        },
    };
}

export const CHAMPIONS_LIST: ChampionProfile[] = [
    champion('Steinitz', true, 1886, 1894),
    champion('Lasker', true, 1894, 1921),
    champion('Rubinstein', false, 1901, 1932),
    champion('Capablanca', true, 1921, 1927),
    champion('Alekhine', true, 1927, 1946),
    champion('Euwe', true, 1935, 1937),
    champion('Keres', false, 1935, 1975),
    champion('Botvinnik', true, 1948, 1963),
    champion('Geller', false, 1949, 1998),
    champion('Korchnoi', false, 1952, 2015),
    champion('Smyslov', true, 1957, 1958),
    champion('Tal', true, 1960, 1961),
    champion('Petrosian', true, 1963, 1969),
    champion('Spassky', true, 1969, 1972),
    champion('Fischer', true, 1972, 1975),
    champion('Karpov', true, 1975, 1985),
    champion('Kasparov', true, 1985, 2000),
    champion('Kramnik', true, 2000, 2007),
    champion('Anand', true, 2007, 2013),
    champion('Carlsen', true, 2013, 2023),
    champion('Ding', true, 2023, null),
];
