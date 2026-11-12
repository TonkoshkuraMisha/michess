// --- FILE: frontend/src/components/About.tsx ---
// «О проекте»: чужие работы, которые использует michess, их авторы и лицензии. Список фигур берётся
// из того же конфига, что и выбор набора в интерфейсе, портреты — из манифеста, который пишет
// scripts/download_champions.py, поэтому страница не расходится с тем, что реально раздаётся.

import {Link} from 'react-router-dom';
import {ArrowLeft, Scale} from 'lucide-react';
import {PIECE_SETS} from '../config/boardAppearance';
import portraitCredits from '../config/portraitCredits.json';
import {CHAMPIONS_LIST, HISTORICAL_BOTS_LIST} from '../config/champions';
import {useI18n} from '../i18n';
import type {MessageKey} from '../i18n';

interface PortraitCredit {
    file: string;
    license: string;
    license_url: string;
    author: string;
    source_url: string;
}

const PORTRAITS = portraitCredits as Record<string, PortraitCredit>;

/** Имя шахматиста на текущем языке (геттеры профилей читают каталог при обращении). */
function playerName(id: string): string {
    return HISTORICAL_BOTS_LIST.find((bot) => bot.id === id)?.name
        ?? CHAMPIONS_LIST.find((champ) => champ.id === id)?.name
        ?? id;
}

/** name — собственное имя библиотеки; nameKey — подпись с пояснением, которая переводится. */
const LIBRARIES: Array<{ name: string; nameKey?: MessageKey; license: string; url: string }> = [
    {name: 'Stockfish', nameKey: 'about.stockfish', license: 'GPL-3.0', url: 'https://github.com/official-stockfish/Stockfish'},
    {name: 'python-chess', license: 'GPL-3.0', url: 'https://github.com/niklasf/python-chess'},
    {name: 'chess.js', license: 'BSD-2-Clause', url: 'https://github.com/jhlywa/chess.js'},
    {name: 'FastAPI', license: 'MIT', url: 'https://github.com/fastapi/fastapi'},
    {name: 'SQLAlchemy', license: 'MIT', url: 'https://github.com/sqlalchemy/sqlalchemy'},
    {name: 'React', license: 'MIT', url: 'https://github.com/facebook/react'},
    {name: 'Tailwind CSS', license: 'MIT', url: 'https://github.com/tailwindlabs/tailwindcss'},
    {name: 'Recharts', license: 'MIT', url: 'https://github.com/recharts/recharts'},
    {name: 'Lucide', nameKey: 'about.lucide', license: 'ISC', url: 'https://github.com/lucide-icons/lucide'},
    {name: 'date-fns', license: 'MIT', url: 'https://github.com/date-fns/date-fns'},
];

const sectionClass = 'bg-acacia-dark border border-amber-900/40 p-5 rounded shadow-heavy';
const headingClass = 'text-lg font-bold text-amber-200 mb-2';
const linkClass = 'text-amber-400 hover:underline';
const cellClass = 'py-1.5 pr-4 align-top';

export default function About() {
    const {t, rich} = useI18n();
    return (
        <div className="w-full max-w-4xl flex flex-col gap-5 text-boxwood-light select-text">
            <div className={`${sectionClass} flex items-center justify-between gap-4`}>
                <div className="flex items-center gap-4">
                    <div
                        className="w-12 h-12 rounded-lg bg-black/40 border-2 border-amber-600/50 flex items-center justify-center text-amber-400 shrink-0">
                        <Scale size={26}/>
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-amber-200">{t('about.title')}</h1>
                        <p className="text-sm text-boxwood/75">
                            {t('about.subtitle')}
                        </p>
                    </div>
                </div>
                <Link to="/" className={`${linkClass} flex items-center gap-1.5 text-sm shrink-0`}>
                    <ArrowLeft size={15}/> {t('common.backToGame')}
                </Link>
            </div>

            <section className={sectionClass}>
                <h2 className={headingClass}>{t('about.engineTitle')}</h2>
                <p className="text-sm leading-relaxed">
                    {rich('about.engineText', {
                        link: <a key="link" className={linkClass} href="https://github.com/official-stockfish/Stockfish"
                                 target="_blank" rel="noreferrer">github.com/official-stockfish/Stockfish</a>,
                    })}
                </p>
            </section>

            <section className={sectionClass}>
                <h2 className={headingClass}>{t('about.piecesTitle')}</h2>
                <table className="w-full text-sm">
                    <thead>
                    <tr className="text-left text-boxwood/65 border-b border-amber-900/40">
                        <th className={cellClass}>{t('about.pieceSet')}</th>
                        <th className={cellClass}>{t('about.author')}</th>
                        <th className={cellClass}>{t('about.license')}</th>
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
                    {t('about.piecesNote')}
                </p>
            </section>

            <section className={sectionClass}>
                <h2 className={headingClass}>{t('about.portraitsTitle')}</h2>
                <p className="text-xs text-boxwood/65 mb-2">
                    {t('about.portraitsNote')}
                </p>
                <table className="w-full text-sm">
                    <thead>
                    <tr className="text-left text-boxwood/65 border-b border-amber-900/40">
                        <th className={cellClass}>{t('about.chessPlayer')}</th>
                        <th className={cellClass}>{t('about.photographer')}</th>
                        <th className={cellClass}>{t('about.license')}</th>
                    </tr>
                    </thead>
                    <tbody>
                    {Object.entries(PORTRAITS).map(([id, credit]) => (
                        <tr key={id} className="border-b border-amber-900/20 last:border-b-0">
                            <td className={cellClass}>
                                <a className={linkClass} href={credit.source_url} target="_blank" rel="noreferrer">
                                    {playerName(id)}
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
                <h2 className={headingClass}>{t('about.mediaTitle')}</h2>
                <ul className="text-sm leading-relaxed list-disc pl-5 space-y-1">
                    <li>{t('about.sounds')}</li>
                    <li>{t('about.texture')}</li>
                    <li>
                        {rich('about.avatars', {
                            link: <a key="link" className={linkClass} href="https://www.dicebear.com" target="_blank"
                                     rel="noreferrer">DiceBear</a>,
                        })}
                    </li>
                </ul>
            </section>

            <section className={sectionClass}>
                <h2 className={headingClass}>{t('about.archiveTitle')}</h2>
                <p className="text-sm leading-relaxed">
                    {t('about.archiveText')}
                </p>
            </section>

            <section className={sectionClass}>
                <h2 className={headingClass}>{t('about.librariesTitle')}</h2>
                <ul className="text-sm grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
                    {LIBRARIES.map((lib) => (
                        <li key={lib.name} className="flex justify-between gap-3">
                            <a className={linkClass} href={lib.url} target="_blank" rel="noreferrer">{lib.nameKey ? t(lib.nameKey) : lib.name}</a>
                            <span className="font-mono text-xs text-boxwood/70">{lib.license}</span>
                        </li>
                    ))}
                </ul>
            </section>
        </div>
    );
}
