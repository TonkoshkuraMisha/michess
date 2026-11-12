// --- FILE: frontend/src/components/About.tsx ---
// «О проекте»: чужие работы, которые использует michess, их авторы и лицензии. Список фигур берётся
// из того же конфига, что и выбор набора в интерфейсе, портреты — из манифеста, который пишет
// scripts/download_champions.py, поэтому страница не расходится с тем, что реально раздаётся.

import {Link} from 'react-router-dom';
import {ArrowLeft, Scale} from 'lucide-react';
import {PIECE_SETS} from '../config/boardAppearance';
import portraitCredits from '../config/portraitCredits.json';
import {CHAMPIONS_LIST, HISTORICAL_BOTS_LIST} from '../config/champions';

interface PortraitCredit {
    file: string;
    license: string;
    license_url: string;
    author: string;
    source_url: string;
}

const PORTRAITS = portraitCredits as Record<string, PortraitCredit>;

const PLAYER_NAMES: Record<string, string> = {
    ...Object.fromEntries(HISTORICAL_BOTS_LIST.map((bot) => [bot.id, bot.name])),
    ...Object.fromEntries(CHAMPIONS_LIST.map((champ) => [champ.id, champ.name])),
};

const LIBRARIES: Array<{ name: string; license: string; url: string }> = [
    {name: 'Stockfish (шахматный движок)', license: 'GPL-3.0', url: 'https://github.com/official-stockfish/Stockfish'},
    {name: 'python-chess', license: 'GPL-3.0', url: 'https://github.com/niklasf/python-chess'},
    {name: 'chess.js', license: 'BSD-2-Clause', url: 'https://github.com/jhlywa/chess.js'},
    {name: 'FastAPI', license: 'MIT', url: 'https://github.com/fastapi/fastapi'},
    {name: 'SQLAlchemy', license: 'MIT', url: 'https://github.com/sqlalchemy/sqlalchemy'},
    {name: 'React', license: 'MIT', url: 'https://github.com/facebook/react'},
    {name: 'Tailwind CSS', license: 'MIT', url: 'https://github.com/tailwindlabs/tailwindcss'},
    {name: 'Recharts', license: 'MIT', url: 'https://github.com/recharts/recharts'},
    {name: 'Lucide (иконки)', license: 'ISC', url: 'https://github.com/lucide-icons/lucide'},
    {name: 'date-fns', license: 'MIT', url: 'https://github.com/date-fns/date-fns'},
];

const sectionClass = 'bg-acacia-dark border border-amber-900/40 p-5 rounded shadow-heavy';
const headingClass = 'text-lg font-bold text-amber-200 mb-2';
const linkClass = 'text-amber-400 hover:underline';
const cellClass = 'py-1.5 pr-4 align-top';

export default function About() {
    return (
        <div className="w-full max-w-4xl flex flex-col gap-5 text-boxwood-light select-text">
            <div className={`${sectionClass} flex items-center justify-between gap-4`}>
                <div className="flex items-center gap-4">
                    <div
                        className="w-12 h-12 rounded-lg bg-black/40 border-2 border-amber-600/50 flex items-center justify-center text-amber-400 shrink-0">
                        <Scale size={26}/>
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-amber-200">О проекте и лицензиях</h1>
                        <p className="text-sm text-boxwood/75">
                            Чужие работы, на которых построен michess, их авторы и условия использования.
                        </p>
                    </div>
                </div>
                <Link to="/" className={`${linkClass} flex items-center gap-1.5 text-sm shrink-0`}>
                    <ArrowLeft size={15}/> К игре
                </Link>
            </div>

            <section className={sectionClass}>
                <h2 className={headingClass}>Шахматный движок</h2>
                <p className="text-sm leading-relaxed">
                    Анализ партий и игра ботов работают на движке Stockfish. Он распространяется по лицензии
                    GNU GPL версии 3; исходный код —{' '}
                    <a className={linkClass} href="https://github.com/official-stockfish/Stockfish" target="_blank"
                       rel="noreferrer">github.com/official-stockfish/Stockfish</a>. Движок запускается как
                    отдельная программа и не изменён.
                </p>
            </section>

            <section className={sectionClass}>
                <h2 className={headingClass}>Наборы фигур</h2>
                <table className="w-full text-sm">
                    <thead>
                    <tr className="text-left text-boxwood/65 border-b border-amber-900/40">
                        <th className={cellClass}>Набор</th>
                        <th className={cellClass}>Автор</th>
                        <th className={cellClass}>Лицензия</th>
                    </tr>
                    </thead>
                    <tbody>
                    {Object.values(PIECE_SETS).map((set) => (
                        <tr key={set.id} className="border-b border-amber-900/20 last:border-b-0">
                            <td className={cellClass}>{set.shortName}</td>
                            <td className={cellClass}>{set.author}</td>
                            <td className={`${cellClass} font-mono text-xs`}>{set.license}</td>
                        </tr>
                    ))}
                    </tbody>
                </table>
                <p className="text-xs text-boxwood/65 mt-2">
                    Файлы наборов взяты из репозитория lichess.org (lila), где указаны те же авторы и лицензии.
                </p>
            </section>

            <section className={sectionClass}>
                <h2 className={headingClass}>Портреты шахматистов</h2>
                <p className="text-xs text-boxwood/65 mb-2">
                    Изображения с Викисклада, уменьшены до 500 пикселей по ширине. Работы под лицензиями
                    CC BY-SA распространяются на тех же условиях.
                </p>
                <table className="w-full text-sm">
                    <thead>
                    <tr className="text-left text-boxwood/65 border-b border-amber-900/40">
                        <th className={cellClass}>Шахматист</th>
                        <th className={cellClass}>Автор снимка</th>
                        <th className={cellClass}>Лицензия</th>
                    </tr>
                    </thead>
                    <tbody>
                    {Object.entries(PORTRAITS).map(([id, credit]) => (
                        <tr key={id} className="border-b border-amber-900/20 last:border-b-0">
                            <td className={cellClass}>
                                <a className={linkClass} href={credit.source_url} target="_blank" rel="noreferrer">
                                    {PLAYER_NAMES[id] ?? id}
                                </a>
                            </td>
                            <td className={`${cellClass} wrap-break-word`}>{credit.author}</td>
                            <td className={`${cellClass} font-mono text-xs whitespace-nowrap`}>
                                {credit.license_url ? (
                                    <a className={linkClass} href={credit.license_url} target="_blank"
                                       rel="noreferrer">{credit.license}</a>
                                ) : credit.license}
                            </td>
                        </tr>
                    ))}
                    </tbody>
                </table>
            </section>

            <section className={sectionClass}>
                <h2 className={headingClass}>Звуки, текстуры и аватары</h2>
                <ul className="text-sm leading-relaxed list-disc pl-5 space-y-1">
                    <li>Звуки ходов и сигналов синтезируются в браузере — готовых записей в проекте нет.</li>
                    <li>Текстура дерева на доске — собственная процедурная графика проекта.</li>
                    <li>
                        Аватары игроков рисует сервис{' '}
                        <a className={linkClass} href="https://www.dicebear.com" target="_blank"
                           rel="noreferrer">DiceBear</a>{' '}
                        (стиль Bottts Neutral, автор исходного набора — Pablo Stanley). Для этого имя игрока
                        передаётся на сервер DiceBear.
                    </li>
                </ul>
            </section>

            <section className={sectionClass}>
                <h2 className={headingClass}>Архив партий</h2>
                <p className="text-sm leading-relaxed">
                    Записи исторических партий — общеизвестные факты и не являются объектом авторского права.
                    Тексты партий загружены из открытых коллекций PGN (pgnmentor.com).
                </p>
            </section>

            <section className={sectionClass}>
                <h2 className={headingClass}>Программные библиотеки</h2>
                <ul className="text-sm grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
                    {LIBRARIES.map((lib) => (
                        <li key={lib.name} className="flex justify-between gap-3">
                            <a className={linkClass} href={lib.url} target="_blank" rel="noreferrer">{lib.name}</a>
                            <span className="font-mono text-xs text-boxwood/70">{lib.license}</span>
                        </li>
                    ))}
                </ul>
            </section>
        </div>
    );
}
