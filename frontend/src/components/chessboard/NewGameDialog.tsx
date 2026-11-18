// --- FILE: frontend/src/components/chessboard/NewGameDialog.tsx ---
// Окно «Новая партия» игрового зала (схема владельца 18.11): шаги «С кем → Время → Начать» вместо того, чтобы держать
// все настройки в левой колонке. Окно только ведёт по шагам и помнит выбор; сами панели (контроль времени, поиск
// соперника и вызов друга, каталог ботов, мастерская, лестница) передаёт игровой зал — их правила не менялись.
// Выбор «с кем» хранится в localStorage (regence_new_game_who): повторно окно открывается сразу на шаге «Начать»,
// и новая партия начинается в два щелчка. Закрывает окно игровой зал, когда партия началась.

import {useEffect, useState} from 'react';
import type {ReactNode} from 'react';
import {Bot, Clock, Swords, Users} from 'lucide-react';
import {useI18n} from '../../i18n';
import {Button, Card, CardGrid, Modal} from '../ui';

export type Opponent = 'human' | 'bot';
type Step = 'who' | 'time' | 'start';
const STEPS: Step[] = ['who', 'time', 'start'];
const STORAGE_KEY = 'regence_new_game_who';

function savedOpponent(): Opponent | null {
    try {
        const value = localStorage.getItem(STORAGE_KEY);
        return value === 'human' || value === 'bot' ? value : null;
    } catch {
        return null;  // хранилище недоступно (приватный режим) — окно начнёт с первого шага
    }
}

interface Props {
    open: boolean;
    onClose: () => void;
    /** Шаг «Время»: выбор контроля времени. */
    timeControl: ReactNode;
    /** Шаг «Начать» с человеком: тип партии, поиск соперника, вызов друга. */
    human: ReactNode;
    /** Шаг «Начать» с ботом: исторические мастера, мастерская, лестница. */
    bots: ReactNode;
}

export function NewGameDialog({open, onClose, timeControl, human, bots}: Props) {
    const {t} = useI18n();
    const [opponent, setOpponent] = useState<Opponent | null>(savedOpponent);
    const [step, setStep] = useState<Step>(opponent ? 'start' : 'who');

    // При каждом открытии выбор читается заново: с запомненным соперником — сразу к старту, иначе — с первого шага.
    useEffect(() => {
        if (!open) return;
        const saved = savedOpponent();
        setOpponent(saved);
        setStep(saved ? 'start' : 'who');
    }, [open]);

    const choose = (next: Opponent) => {
        setOpponent(next);
        try {
            localStorage.setItem(STORAGE_KEY, next);
        } catch {
            // не запомнили — в следующий раз окно просто начнёт с первого шага
        }
        setStep('time');
    };

    const reachable = (target: Step) => target === 'who' || opponent !== null;

    return (
        <Modal open={open} onClose={onClose} size="lg" testId="new-game" icon={<Swords size={20}/>} title={t('newGame.title')}>
            <ol className="grid grid-cols-3 gap-1 text-xs font-bold" data-testid="new-game-steps">
                {STEPS.map((id, index) => (
                    <li key={id}>
                        <button type="button" disabled={!reachable(id)} onClick={() => setStep(id)}
                                aria-current={step === id ? 'step' : undefined} data-testid={`new-game-step-${id}`}
                                className={`w-full rounded-md px-2 py-1.5 border transition-colors cursor-pointer disabled:cursor-default disabled:opacity-40 ${
                                    step === id ? 'bg-amber-700 text-white border-amber-500' : 'bg-black/30 border-amber-900/50 hover:border-amber-600'}`}>
                            {index + 1}. {t(`newGame.steps.${id}`)}
                        </button>
                    </li>
                ))}
            </ol>

            {step === 'who' && (
                <CardGrid cols={2}>
                    <Card onClick={() => choose('human')} testId="new-game-who-human" icon={<Users size={22}/>}
                          variant={opponent === 'human' ? 'hero' : 'default'}
                          title={t('newGame.human')} description={t('newGame.humanText')}/>
                    <Card onClick={() => choose('bot')} testId="new-game-who-bot" icon={<Bot size={22}/>}
                          variant={opponent === 'bot' ? 'hero' : 'default'}
                          title={t('newGame.bot')} description={t('newGame.botText')}/>
                </CardGrid>
            )}

            {step === 'time' && (
                <div className="flex flex-col gap-3">
                    <p className="text-sm text-boxwood/85 flex items-center gap-1.5"><Clock size={15}/> {t('newGame.timeText')}</p>
                    {timeControl}
                    <Button variant="primary" className="self-end" onClick={() => setStep('start')} data-testid="new-game-next">
                        {t('newGame.next')}
                    </Button>
                </div>
            )}

            {step === 'start' && opponent && (
                <div className="flex flex-col gap-2 min-h-0" data-testid={`new-game-start-${opponent}`}>
                    {opponent === 'human' ? human : bots}
                </div>
            )}
        </Modal>
    );
}
