// --- FILE: frontend/src/components/puzzles/PuzzleModePicker.tsx ---
// Выбор режима на странице задач (план владельца 18.11): три группы вкладок с подписью группы («Решать»,
// «Тренироваться», «Свои партии») и одной строкой пояснения к выбранному режиму. Состав групп и иконки —
// puzzleModes.ts; тексты — puzzles.modeGroups.*, puzzles.modes.*, puzzles.modeInfo.* в трёх каталогах.
// Кнопки режимов — data-testid «puzzle-mode-<режим>»; тот же id у карточек режимов до старта (PuzzlesPage): на экране
// всегда только одно из двух, а тесты идут путём игрока, не зная, что сейчас показано.
// Состояния не держит: выбранный режим и обработчик приходят из PuzzlesPage.

import {useI18n} from '../../i18n';
import {SegmentedControl} from '../ui';
import {MODE_GROUPS, MODE_ICONS} from './puzzleModes';
import type {Mode} from './puzzleModes';

interface Props {
    mode: Mode;
    onChange: (mode: Mode) => void;
}

/** Вкладки режимов по группам плюс строка пояснения к текущему режиму (data-testid «puzzle-mode-info»). */
export function PuzzleModePicker({mode, onChange}: Props) {
    const {t} = useI18n();
    return (
        <div className="flex flex-col gap-2" data-testid="puzzle-modes">
            <div className="flex flex-wrap gap-x-4 gap-y-2">
                {MODE_GROUPS.map((group) => (
                    <div key={group.id} className="flex flex-col gap-1 min-w-0">
                        <span className="text-[11px] uppercase tracking-wider font-bold text-boxwood/70">
                            {t(`puzzles.modeGroups.${group.id}`)}
                        </span>
                        <SegmentedControl<Mode>
                            label={t(`puzzles.modeGroups.${group.id}`)}
                            value={mode}
                            onChange={onChange}
                            testIdPrefix="puzzle-mode"
                            options={group.modes.map((id) => {
                                const Icon = MODE_ICONS[id];
                                return {id, label: t(`puzzles.modes.${id}`), icon: <Icon size={14} aria-hidden/>};
                            })}
                        />
                    </div>
                ))}
            </div>
            <p className="text-sm text-boxwood/85 leading-snug" data-testid="puzzle-mode-info">
                {t(`puzzles.modeInfo.${mode}`)}
            </p>
        </div>
    );
}
