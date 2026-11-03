// --- FILE: frontend/src/config/champions.ts ---

import philidorAvatar from '../assets/champions/philidor.jpg';
import labourdonnaisAvatar from '../assets/champions/labourdonnais.jpg';
import stauntonAvatar from '../assets/champions/staunton.jpg';
import anderssenAvatar from '../assets/champions/anderssen.jpg';
import morphyAvatar from '../assets/champions/morphy.jpg';
import paulsenAvatar from '../assets/champions/paulsen.jpg';
import zukertortAvatar from '../assets/champions/zukertort.jpg';

export type HistoricalBotId =
    | 'philidor'
    | 'labourdonnais'
    | 'staunton'
    | 'anderssen'
    | 'morphy'
    | 'paulsen'
    | 'zukertort';

export interface HistoricalBotProfile {
    id: HistoricalBotId;
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

export const HISTORICAL_BOTS: Record<HistoricalBotId, HistoricalBotProfile> = {
    philidor: {
        id: 'philidor',
        name: 'Франсуа-Андре Филидор',
        shortName: 'Филидор',
        playerLabel: 'Ф.-А. Филидор',
        title: 'Мастер Просвещения',
        era: '1749–1795',
        rating: 1850,
        motto: 'Пешки — душа шахмат: именно они определяют атаку и защиту.',
        avatar: philidorAvatar,
        fallbackAvatar: '/assets/champions/philidor.jpg'
    },
    labourdonnais: {
        id: 'labourdonnais',
        name: 'Луи-Шарль Лабурдонне',
        shortName: 'Лабурдонне',
        playerLabel: 'Л.-Ш. Лабурдонне',
        title: 'Король Комбинаций',
        era: '1795–1840',
        rating: 1950,
        motto: 'Инициатива, гамбит и стремительная атака на короля!',
        avatar: labourdonnaisAvatar,
        fallbackAvatar: '/assets/champions/labourdonnais.jpg'
    },
    staunton: {
        id: 'staunton',
        name: 'Говард Стаунтон',
        shortName: 'Стаунтон',
        playerLabel: 'Г. Стаунтон',
        title: 'Глава Английской Школы',
        era: '1810–1874',
        rating: 2000,
        motto: 'Фланговый зажим центра, прочная структура и классический расчёт.',
        avatar: stauntonAvatar,
        fallbackAvatar: '/assets/champions/staunton.jpg'
    },
    anderssen: {
        id: 'anderssen',
        name: 'Адольф Андерсен',
        shortName: 'Андерсен',
        playerLabel: 'А. Андерсен',
        title: 'Маэстро Бессмертных Партий',
        era: '1818–1879',
        rating: 2100,
        motto: 'Бриллиантовая жертва фигуры ради вскрытия линий и мата королю!',
        avatar: anderssenAvatar,
        fallbackAvatar: '/assets/champions/anderssen.jpg'
    },
    morphy: {
        id: 'morphy',
        name: 'Пол Чарльз Морфи',
        shortName: 'Морфи',
        playerLabel: 'Пол Морфи',
        title: 'Гордость и печаль шахмат',
        era: '1837–1884',
        rating: 2150,
        motto: 'Развивайте все фигуры с темпом и вскрывайте линии для атаки!',
        avatar: morphyAvatar,
        fallbackAvatar: '/assets/champions/morphy.jpg'
    },
    paulsen: {
        id: 'paulsen',
        name: 'Луи Паульсен',
        shortName: 'Паульсен',
        playerLabel: 'Л. Паульсен',
        title: 'Мастер Защиты и Двух Слонов',
        era: '1833–1891',
        rating: 2080,
        motto: 'Гибкая оборона, сила двух слонов и глубокие дебютные новинки.',
        avatar: paulsenAvatar,
        fallbackAvatar: '/assets/champions/paulsen.jpg'
    },
    zukertort: {
        id: 'zukertort',
        name: 'Иоганн Герман Цукерторт',
        shortName: 'Цукерторт',
        playerLabel: 'И. Цукерторт',
        title: 'Триумфатор Лондона 1883',
        era: '1842–1888',
        rating: 2120,
        motto: 'Универсальная гармония развития и сокрушительные комбинационные бури!',
        avatar: zukertortAvatar,
        fallbackAvatar: '/assets/champions/zukertort.jpg'
    }
};

export const HISTORICAL_BOTS_LIST: HistoricalBotProfile[] = Object.values(HISTORICAL_BOTS);

export const CHAMPIONS_LIST = [
    {id: 'Steinitz', name: 'Вильгельм Стейниц', years: '1886–1894', img: '/assets/champions/Steinitz.jpg'},
    {id: 'Lasker', name: 'Эмануил Ласкер', years: '1894–1921', img: '/assets/champions/Lasker.jpg'},
    {id: 'Rubinstein', name: 'Акиба Рубинштейн', years: '1901–1932', img: '/assets/champions/Rubinstein.jpg'},
    {id: 'Capablanca', name: 'Хосе Рауль Капабланка', years: '1921–1927', img: '/assets/champions/Capablanca.jpg'},
    {id: 'Alekhine', name: 'Александр Алехин', years: '1927–1946', img: '/assets/champions/Alekhine.jpg'},
    {id: 'Euwe', name: 'Макс Эйве', years: '1935–1937', img: '/assets/champions/Euwe.jpg'},
    {id: 'Keres', name: 'Пауль Керес', years: '1935–1975', img: '/assets/champions/Keres.jpg'},
    {id: 'Botvinnik', name: 'Михаил Ботвинник', years: '1948–1963', img: '/assets/champions/Botvinnik.jpg'},
    {id: 'Geller', name: 'Ефим Геллер', years: '1949–1998', img: '/assets/champions/Geller.jpg'},
    {id: 'Korchnoi', name: 'Виктор Корчной', years: '1952–2015', img: '/assets/champions/Korchnoi.jpg'},
    {id: 'Smyslov', name: 'Василий Смыслов', years: '1957–1958', img: '/assets/champions/Smyslov.jpg'},
    {id: 'Tal', name: 'Михаил Таль', years: '1960–1961', img: '/assets/champions/Tal.jpg'},
    {id: 'Petrosian', name: 'Тигран Петросян', years: '1963–1969', img: '/assets/champions/Petrosian.jpg'},
    {id: 'Spassky', name: 'Борис Спасский', years: '1969–1972', img: '/assets/champions/Spassky.jpg'},
    {id: 'Fischer', name: 'Роберт Фишер', years: '1972–1975', img: '/assets/champions/Fischer.jpg'},
    {id: 'Karpov', name: 'Анатолий Карпов', years: '1975–1985', img: '/assets/champions/Karpov.jpg'},
    {id: 'Kasparov', name: 'Гарри Каспаров', years: '1985–2000', img: '/assets/champions/Kasparov.jpg'},
    {id: 'Kramnik', name: 'Владимир Крамник', years: '2000–2007', img: '/assets/champions/Kramnik.jpg'},
    {id: 'Anand', name: 'Вишванатан Ананд', years: '2007–2013', img: '/assets/champions/Anand.jpg'},
    {id: 'Carlsen', name: 'Магнус Карлсен', years: '2013–2023', img: '/assets/champions/Carlsen.jpg'},
    {id: 'Ding', name: 'Дин Лижэнь', years: '2023–н.в.', img: '/assets/champions/Ding.jpg'}
];