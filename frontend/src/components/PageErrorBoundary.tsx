// Предохранитель страниц: ошибка отрисовки одной страницы не гасит всё приложение — шапка и меню остаются,
// на месте страницы сообщение и «Обновить». Сбрасывается при переходе на другой адрес (resetKey).

import {Component} from 'react';
import type {ErrorInfo, ReactNode} from 'react';
import {Link} from 'react-router-dom';
import {useI18n} from '../i18n';

function Fallback() {
    const {t} = useI18n();
    return (
        <div className="w-full max-w-xl mx-auto p-6 flex flex-col gap-3 text-boxwood-light" role="alert" data-testid="page-error">
            <h1 className="text-xl font-bold text-amber-200">{t('common.pageError')}</h1>
            <p className="text-boxwood/85">{t('common.pageErrorHint')}</p>
            <div className="flex flex-wrap gap-3">
                <button type="button" onClick={() => window.location.reload()} className="px-4 py-2 rounded bg-amber-700 text-white font-bold">
                    {t('common.pageReload')}
                </button>
                <Link to="/" className="px-4 py-2 rounded bg-black/40 text-amber-200">{t('common.pageHome')}</Link>
            </div>
        </div>
    );
}

interface Props {
    resetKey: string;
    children: ReactNode;
}

interface State {
    failed: boolean;
    key: string;
}

export class PageErrorBoundary extends Component<Props, State> {
    state: State = {failed: false, key: this.props.resetKey};

    static getDerivedStateFromError(): Partial<State> {
        return {failed: true};
    }

    static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
        return props.resetKey !== state.key ? {failed: false, key: props.resetKey} : null;
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        console.error('page error', error, info.componentStack);
    }

    render() {
        return this.state.failed ? <Fallback/> : this.props.children;
    }
}
