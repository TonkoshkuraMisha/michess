// --- FILE: frontend/src/components/ui/Modal.tsx ---
// Модальное окно (общие компоненты дизайна, план владельца 18.11): затемнение, заголовок с иконкой, крестик,
// закрытие по Esc и щелчку мимо окна. Тот же вид раньше повторяли окно входа и «Сообщить о проблеме»; новые окна
// (первое — «Новая партия» в игровом зале) строятся на этом компоненте. Тексты — у вызывающего (три языка).

import {useEffect} from 'react';
import type {ReactNode} from 'react';
import {X} from 'lucide-react';
import {useI18n} from '../../i18n';

/** Ширина окна: md — форма, lg — выбор из каталога (карточки в две-три колонки). */
const SIZES = {md: 'max-w-md', lg: 'max-w-3xl'} as const;

interface ModalProps {
    open: boolean;
    onClose: () => void;
    title: ReactNode;
    icon?: ReactNode;
    size?: keyof typeof SIZES;
    testId?: string;
    children: ReactNode;
}

export function Modal({open, onClose, title, icon, size = 'md', testId, children}: ModalProps) {
    const {t} = useI18n();
    useEffect(() => {
        if (!open) return;
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open, onClose]);
    if (!open) return null;
    return (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-start sm:items-center justify-center z-50 p-3 sm:p-4 overflow-y-auto"
             onMouseDown={(event) => {
                 if (event.target === event.currentTarget) onClose();
             }}>
            <div role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined} data-testid={testId}
                 className={`relative w-full ${SIZES[size]} bg-[#261C14] border-2 border-amber-900/80 rounded-lg p-4 sm:p-5 shadow-heavy text-boxwood-light flex flex-col gap-3 max-h-[calc(100dvh-1.5rem)] overflow-y-auto`}>
                <button type="button" onClick={onClose} title={t('common.closeEsc')} aria-label={t('common.close')}
                        data-testid={testId ? `${testId}-close` : undefined}
                        className="absolute top-3 right-3 p-1 rounded text-boxwood/70 hover:text-amber-200 hover:bg-black/30 transition cursor-pointer">
                    <X size={18}/>
                </button>
                <h2 className="text-xl font-bold text-amber-200 flex items-center gap-2 pr-8">{icon}{title}</h2>
                {children}
            </div>
        </div>
    );
}
