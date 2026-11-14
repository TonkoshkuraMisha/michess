// --- FILE: frontend/src/components/Settings.tsx ---
// Настройки: оформление доски, звук, смена пароля и завершение сессий на всех устройствах.

import {useState} from 'react';
import {Link} from 'react-router-dom';
import {ArrowLeft, Check, Download, KeyRound, Languages, LogOut, Palette, Settings as SettingsIcon, Trash2, Volume2, VolumeX} from 'lucide-react';
import {API_BASE_URL} from '../config/api';
import {
    BOARD_THEMES,
    PIECE_SETS,
    getPieceSvgUrl,
    getSavedBoardThemeKey,
    getSavedPieceSetKey,
} from '../config/boardAppearance';
import {readApiErrorOr} from '../services/apiErrors';
import {gameSocket} from '../services/gameSocket';
import {soundEngine} from '../services/soundEngine';
import {useI18n} from '../i18n';
import {renderUiMessage} from '../i18n';
import type {UiMessage} from '../i18n';
import LanguageSwitcher from './LanguageSwitcher';

const MIN_PASSWORD_LENGTH = 8;

interface SettingsProps {
    token: string | null;
    username: string | null;
    /** Сервер выдал новый токен (после смены пароля прежние отозваны). */
    onTokenChange: (token: string) => void;
    onLogoutEverywhere: () => void | Promise<void>;
    /** Аккаунт удалён (таск 17.5): токен уже недействителен — выйти. */
    onAccountDeleted?: () => void;
}

const sectionClass = 'bg-acacia-dark border border-amber-900/40 p-5 rounded shadow-heavy';
const headingClass = 'text-lg font-bold text-amber-200 mb-3 flex items-center gap-2';
const inputClass =
    'w-full px-3 py-2 rounded bg-black/40 border border-amber-900/60 text-boxwood-light text-sm outline-none focus:border-amber-500';
const optionClass = (active: boolean) =>
    `p-2 rounded-md border text-left text-sm transition cursor-pointer flex items-center gap-2.5 ${
        active
            ? 'bg-amber-800/70 border-amber-400 text-white'
            : 'bg-black/35 border-amber-900/40 text-boxwood/85 hover:border-amber-600/60'
    }`;

export default function Settings({token, username, onTokenChange, onLogoutEverywhere, onAccountDeleted}: SettingsProps) {
    const {t} = useI18n();
    const [boardThemeKey, setBoardThemeKey] = useState(() => getSavedBoardThemeKey());
    const [pieceSetKey, setPieceSetKey] = useState(() => getSavedPieceSetKey());
    const [isMuted, setIsMuted] = useState(() => soundEngine.isMuted());

    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [repeatPassword, setRepeatPassword] = useState('');
    const [passwordError, setPasswordError] = useState<UiMessage | null>(null);
    const [passwordSaved, setPasswordSaved] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    // Мои данные (таски 17.5, 23.1): выгрузка и удаление аккаунта.
    const [dataError, setDataError] = useState<UiMessage | null>(null);
    const [deletePassword, setDeletePassword] = useState('');
    const [isDeleting, setIsDeleting] = useState(false);

    const downloadMyData = async () => {
        if (!token) return;
        setDataError(null);
        try {
            const res = await fetch(`${API_BASE_URL}/api/v1/account/export`, {headers: {Authorization: `Bearer ${token}`}});
            if (!res.ok) {
                setDataError(await readApiErrorOr(res, 'settings.exportFailed'));
                return;
            }
            const blob = new Blob([JSON.stringify(await res.json(), null, 2)], {type: 'application/json'});
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `michess-${username ?? 'data'}.json`;
            link.click();
            URL.revokeObjectURL(url);
        } catch {
            setDataError({key: 'common.noConnection'});
        }
    };

    const deleteAccount = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!token || !deletePassword || !window.confirm(t('settings.deleteConfirm'))) return;
        setDataError(null);
        setIsDeleting(true);
        try {
            const res = await fetch(`${API_BASE_URL}/api/v1/account/delete`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json', Authorization: `Bearer ${token}`},
                body: JSON.stringify({password: deletePassword}),
            });
            if (!res.ok) {
                setDataError(await readApiErrorOr(res, 'settings.deleteFailed'));
                return;
            }
            gameSocket.disconnect();
            localStorage.removeItem('token');
            onAccountDeleted?.();
        } catch {
            setDataError({key: 'common.noConnection'});
        } finally {
            setIsDeleting(false);
        }
    };

    const selectBoardTheme = (themeId: string) => {
        setBoardThemeKey(themeId);
        localStorage.setItem('michess_board_theme', themeId);
    };

    const selectPieceSet = (setId: string) => {
        setPieceSetKey(setId);
        localStorage.setItem('michess_piece_set', setId);
        soundEngine.play('move');
    };

    const toggleSound = () => {
        const nextMuted = soundEngine.toggleMute();
        setIsMuted(nextMuted);
        if (!nextMuted) soundEngine.play('move');
    };

    const handleChangePassword = async (e: React.FormEvent) => {
        e.preventDefault();
        setPasswordSaved(false);
        if (newPassword.length < MIN_PASSWORD_LENGTH) {
            setPasswordError({key: 'settings.passwordTooShort', params: {min: MIN_PASSWORD_LENGTH}});
            return;
        }
        if (newPassword !== repeatPassword) {
            setPasswordError({key: 'settings.passwordsDiffer'});
            return;
        }
        if (!token) return;

        setPasswordError(null);
        setIsSaving(true);
        // Смена пароля отзывает все токены, и сервер закрывает WebSocket с кодом «сессия отозвана»
        // раньше, чем придёт ответ с новым токеном. Отключаемся сами, иначе это закрытие
        // разлогинило бы игрока, только что сменившего пароль.
        gameSocket.disconnect();
        try {
            const res = await fetch(`${API_BASE_URL}/api/v1/auth/change-password`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json', Authorization: `Bearer ${token}`},
                body: JSON.stringify({current_password: currentPassword, new_password: newPassword}),
            });
            if (!res.ok) {
                setPasswordError(await readApiErrorOr(res, 'settings.passwordChangeFailed'));
                return;
            }
            const data = await res.json();
            localStorage.setItem('token', data.access_token);
            onTokenChange(data.access_token);
            setCurrentPassword('');
            setNewPassword('');
            setRepeatPassword('');
            setPasswordSaved(true);
        } catch {
            setPasswordError({key: 'common.noConnection'});
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="w-full max-w-4xl flex flex-col gap-5 text-boxwood-light">
            <div className={`${sectionClass} flex items-center justify-between gap-4`}>
                <div className="flex items-center gap-4">
                    <div
                        className="w-12 h-12 rounded-lg bg-black/40 border-2 border-amber-600/50 flex items-center justify-center text-amber-400 shrink-0">
                        <SettingsIcon size={26}/>
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-amber-200">{t('settings.title')}</h1>
                        <p className="text-sm text-boxwood/75">
                            {username ? t('settings.account', {username}) : t('settings.guestNote')}
                        </p>
                    </div>
                </div>
                <Link to="/" className="text-amber-400 hover:underline flex items-center gap-1.5 text-sm shrink-0">
                    <ArrowLeft size={15}/> {t('common.backToGame')}
                </Link>
            </div>

            <section className={sectionClass}>
                <h2 className={headingClass}><Palette size={18} className="text-amber-400"/> {t('settings.boardAndPieces')}</h2>

                <div className="text-xs uppercase tracking-wider text-boxwood/65 font-bold mb-1.5">{t('settings.board')}</div>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-4">
                    {Object.values(BOARD_THEMES).map((theme) => (
                        <button
                            key={theme.id}
                            type="button"
                            aria-pressed={boardThemeKey === theme.id}
                            onClick={() => selectBoardTheme(theme.id)}
                            className={optionClass(boardThemeKey === theme.id)}
                        >
                            <span className="grid grid-cols-2 w-7 h-7 rounded overflow-hidden border border-black/50 shrink-0">
                                <span style={{backgroundColor: theme.light}}/>
                                <span style={{backgroundColor: theme.dark}}/>
                                <span style={{backgroundColor: theme.dark}}/>
                                <span style={{backgroundColor: theme.light}}/>
                            </span>
                            <span className="truncate">{theme.name}</span>
                        </button>
                    ))}
                </div>

                <div className="text-xs uppercase tracking-wider text-boxwood/65 font-bold mb-1.5">{t('settings.pieces')}</div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {Object.values(PIECE_SETS).map((set) => (
                        <button
                            key={set.id}
                            type="button"
                            aria-pressed={pieceSetKey === set.id}
                            title={set.description}
                            onClick={() => selectPieceSet(set.id)}
                            className={optionClass(pieceSetKey === set.id)}
                        >
                            <span
                                className="w-9 h-9 rounded shrink-0 flex items-center justify-center"
                                style={{backgroundColor: (BOARD_THEMES[boardThemeKey] || BOARD_THEMES.walnut).dark}}
                            >
                                <img src={getPieceSvgUrl(set.id, 'w', 'n')} alt="" className="w-8 h-8" draggable={false}/>
                            </span>
                            <span className="truncate">{set.name}</span>
                        </button>
                    ))}
                </div>
            </section>

            <section className={sectionClass}>
                <h2 className={headingClass}><Languages size={18} className="text-amber-400"/> {t('settings.language')}</h2>
                <LanguageSwitcher/>
            </section>

            <section className={sectionClass}>
                <h2 className={headingClass}>
                    {isMuted ? <VolumeX size={18} className="text-amber-400"/> : <Volume2 size={18} className="text-amber-400"/>}
                    {t('settings.sound')}
                </h2>
                <div className="flex flex-wrap items-center gap-3">
                    <button
                        type="button"
                        role="switch"
                        aria-checked={!isMuted}
                        onClick={toggleSound}
                        className={`px-4 py-2 rounded-md border text-sm font-bold transition cursor-pointer ${
                            isMuted
                                ? 'bg-black/40 border-amber-900/60 text-boxwood/80 hover:border-amber-600/60'
                                : 'bg-emerald-900/60 border-emerald-600/70 text-emerald-100 hover:bg-emerald-900/80'
                        }`}
                    >
                        {t(isMuted ? 'settings.soundOff' : 'settings.soundOn')}
                    </button>
                    <button
                        type="button"
                        disabled={isMuted}
                        onClick={() => soundEngine.play('capture')}
                        className="px-3 py-2 rounded-md border border-amber-900/60 bg-black/35 text-sm text-amber-200 hover:border-amber-600/60 transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        {t('settings.soundTest')}
                    </button>
                </div>
            </section>

            {token ? (
                <>
                    <section className={sectionClass}>
                        <h2 className={headingClass}><KeyRound size={18} className="text-amber-400"/> {t('settings.password')}</h2>
                        <form onSubmit={handleChangePassword} className="flex flex-col gap-3 max-w-md">
                            <label className="text-xs text-boxwood/80 flex flex-col gap-1">
                                {t('settings.currentPassword')}
                                <input
                                    type="password"
                                    required
                                    autoComplete="current-password"
                                    value={currentPassword}
                                    onChange={(e) => setCurrentPassword(e.target.value)}
                                    className={inputClass}
                                />
                            </label>
                            <label className="text-xs text-boxwood/80 flex flex-col gap-1">
                                {t('settings.newPassword', {min: MIN_PASSWORD_LENGTH})}
                                <input
                                    type="password"
                                    required
                                    autoComplete="new-password"
                                    value={newPassword}
                                    onChange={(e) => setNewPassword(e.target.value)}
                                    className={inputClass}
                                />
                            </label>
                            <label className="text-xs text-boxwood/80 flex flex-col gap-1">
                                {t('settings.repeatPassword')}
                                <input
                                    type="password"
                                    required
                                    autoComplete="new-password"
                                    value={repeatPassword}
                                    onChange={(e) => setRepeatPassword(e.target.value)}
                                    className={inputClass}
                                />
                            </label>

                            {passwordError && (
                                <div role="alert"
                                     className="text-sm text-red-200 bg-red-950/70 border border-red-800 rounded px-3 py-2">
                                    {renderUiMessage(passwordError, t)}
                                </div>
                            )}
                            {passwordSaved && (
                                <div role="status"
                                     className="text-sm text-emerald-200 bg-emerald-950/60 border border-emerald-700 rounded px-3 py-2 flex items-center gap-2">
                                    <Check size={15}/> {t('settings.passwordChanged')}
                                </div>
                            )}

                            <button
                                type="submit"
                                disabled={isSaving}
                                className="self-start px-4 py-2 rounded-md bg-boxwood text-acacia-dark font-bold text-sm border border-amber-700/50 hover:bg-boxwood-light transition cursor-pointer disabled:opacity-60"
                            >
                                {t(isSaving ? 'settings.saving' : 'settings.changePassword')}
                            </button>
                        </form>
                        <p className="text-xs text-boxwood/60 mt-3 max-w-md">
                            {t('settings.passwordNote')}
                        </p>
                    </section>

                    <section className={sectionClass}>
                        <h2 className={headingClass}><LogOut size={18} className="text-red-400"/> {t('settings.sessions')}</h2>
                        <p className="text-sm text-boxwood/80 mb-3 max-w-xl">
                            {t('settings.sessionsNote')}
                        </p>
                        <button
                            type="button"
                            onClick={() => void onLogoutEverywhere()}
                            className="px-4 py-2 rounded-md bg-red-950/60 border border-red-800 text-red-200 text-sm font-bold hover:bg-red-900/60 transition cursor-pointer"
                        >
                            {t('settings.logoutEverywhere')}
                        </button>
                    </section>

                    <section className={sectionClass} data-testid="settings-my-data">
                        <h2 className={headingClass}><Download size={18} className="text-amber-400"/> {t('settings.myData')}</h2>
                        <p className="text-sm text-boxwood/80 mb-3 max-w-xl">{t('settings.myDataNote')}</p>
                        <button type="button" onClick={() => void downloadMyData()} data-testid="settings-export"
                                className="px-4 py-2 rounded-md bg-amber-800 hover:bg-amber-700 text-white text-sm font-bold transition cursor-pointer flex items-center gap-1.5">
                            <Download size={15}/> {t('settings.exportData')}
                        </button>
                        <form onSubmit={(e) => void deleteAccount(e)} className="mt-5 flex flex-col gap-2 max-w-sm">
                            <p className="text-sm text-red-200 font-bold flex items-center gap-1.5">
                                <Trash2 size={15}/> {t('settings.deleteAccount')}
                            </p>
                            <p className="text-xs text-boxwood/75">{t('settings.deleteNote')}</p>
                            <input type="password" autoComplete="current-password" value={deletePassword}
                                   onChange={(e) => setDeletePassword(e.target.value)} className={inputClass}
                                   placeholder={t('settings.currentPassword')} data-testid="settings-delete-password"/>
                            <button type="submit" disabled={!deletePassword || isDeleting} data-testid="settings-delete"
                                    className="self-start px-4 py-2 rounded-md bg-red-950/60 border border-red-800 text-red-200 text-sm font-bold hover:bg-red-900/60 transition cursor-pointer disabled:opacity-40">
                                {t('settings.deleteAccount')}
                            </button>
                        </form>
                        {dataError && <p className="text-sm text-red-300 mt-2" role="alert">{renderUiMessage(dataError, t)}</p>}
                    </section>
                </>
            ) : (
                <section className={sectionClass}>
                    <p className="text-sm text-boxwood/80">
                        {t('settings.loginToManage')}
                    </p>
                </section>
            )}
        </div>
    );
}
