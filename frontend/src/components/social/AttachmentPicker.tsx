// --- FILE: frontend/src/components/social/AttachmentPicker.tsx ---
// Выбор вложения для публикации ленты (FeedPage.tsx, Composer) и личного сообщения (MessagesPage.tsx): вид вложения
// и ссылка или идентификатор. Вставленная ссылка на партию, задачу, урок и т. п. распознаётся сама
// (detectAttachment из services/messages.ts) — вид выбирается по ней. Достижение вручную не выбирается: оно приходит
// готовым черновиком от кнопки «поделиться» в профиле и показывается подписью. Сеть не нужна: вложение уходит на
// сервер вместе с текстом, проверяет его src/services/attachments.py.

import {X} from 'lucide-react';
import {useI18n} from '../../i18n';
import {detectAttachment} from '../../services/messages';
import type {AttachmentKind} from '../../services/messages';

/** Черновик вложения: вид и ссылка или идентификатор (ref); приходит и из location.state.attach. */
export interface AttachmentDraft {
    kind: AttachmentKind;
    ref: string;
}

/** Виды вложений, выбираемые вручную; достижение добавляется только кнопкой «поделиться» в профиле. */
export const ATTACHMENT_KINDS: AttachmentKind[] = ['game', 'position', 'puzzle', 'lesson', 'tournament', 'library'];

/** Наибольшая длина поля ссылки: целый адрес страницы, из которого detectAttachment достаёт ref (на сервере ref ≤ 100). */
const REF_INPUT_MAX = 200;

/**
 * Строка выбора вложения. testId — префикс data-testid раздела («feed» или «dm»): у полей …-attach, …-attach-kind,
 * …-attach-ref. onRemove — крестик: вложение снято, строка закрывается.
 */
export function AttachmentPicker({draft, onChange, onRemove, testId}: {
    draft: AttachmentDraft | null;
    onChange: (draft: AttachmentDraft) => void;
    onRemove: () => void;
    testId: string;
}) {
    const {t} = useI18n();
    return (
        <div className="flex flex-wrap items-center gap-1.5 text-sm" data-testid={`${testId}-attach`}>
            {draft?.kind === 'achievement' ? (
                <span className="px-1.5 py-1">{t('dm.kinds.achievement')}</span>
            ) : (
                <>
                    <select value={draft?.kind ?? 'game'} className="bg-black/40 rounded px-1.5 py-1" data-testid={`${testId}-attach-kind`}
                            onChange={(e) => onChange({kind: e.target.value as AttachmentKind, ref: draft?.ref ?? ''})}>
                        {ATTACHMENT_KINDS.map((k) => <option key={k} value={k}>{t(`dm.kinds.${k}`)}</option>)}
                    </select>
                    <input value={draft?.ref ?? ''} maxLength={REF_INPUT_MAX} placeholder={t('dm.attachHint')}
                           data-testid={`${testId}-attach-ref`} className="flex-1 min-w-0 bg-black/40 rounded px-2 py-1"
                           onChange={(e) => {
                               const found = detectAttachment(e.target.value);
                               onChange(found ? {kind: found.kind, ref: found.ref} : {kind: draft?.kind ?? 'game', ref: e.target.value});
                           }}/>
                </>
            )}
            <button type="button" onClick={onRemove} aria-label={t('dm.removeAttachment')} title={t('dm.removeAttachment')}
                    className="p-1 text-boxwood/70">
                <X size={14}/>
            </button>
        </div>
    );
}
