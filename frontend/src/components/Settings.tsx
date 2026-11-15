// --- FILE: frontend/src/components/Settings.tsx ---
// Настройки: оформление доски, звук, смена пароля и завершение сессий на всех устройствах.

import {useEffect, useState} from 'react';
import {Link} from 'react-router-dom';
import {ArrowLeft, AtSign, Check, Download, KeyRound, Languages, LogOut, Palette, Settings as SettingsIcon, Trash2, Volume2, VolumeX} from 'lucide-react';
import {API_BASE_URL} from '../config/api';
import {
    BOARD_THEMES,
    PIECE_SETS,
    getPieceSvgUrl,
    getSavedBoardThemeKey,
    getSavedPieceSetKey,
    hasAnalysisAppearance,
    getAnalysisBoardThemeKey,
    setAnalysisAppearance,
} from '../config/boardAppearance';
import {readApiErrorOr} from '../services/apiErrors';
import {PAGE_PALETTES, PAGE_PATTERNS, applyPageBackground, getSavedPagePalette, getSavedPagePattern, pageBackgroundStyle} from '../config/pageBackground';
import type {PagePalette, PagePattern} from '../config/pageBackground';
import {THEME_PRESETS, applyPreset} from '../config/themePresets';
import type {ThemePreset} from '../config/themePresets';
import {ThemePreview} from './settings/ThemePreview';
import {AvatarPicker} from './PlayerAvatar';
import {SOUND_SETS} from '../services/soundEngine';
import type {SoundSetId} from '../services/soundEngine';
import {gameSocket} from '../services/gameSocket';
import {soundEngine} from '../services/soundEngine';
import {useI18n} from '../i18n';
import {renderUiMessage} from '../i18n';
import type {UiMessage} from '../i18n';
import LanguageSwitcher from './LanguageSwitcher';
import {saveProfileSettings, setTranslationHelper} from '../services/profileSettings';
import {clearToken, setToken} from '../services/authToken';

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
    const {t, language} = useI18n();
    const [boardThemeKey, setBoardThemeKey] = useState(() => getSavedBoardThemeKey());
    // Фон страницы (таск 18.1): узор и палитра.
    const [pagePattern, setPagePattern] = useState<PagePattern>(() => getSavedPagePattern());
    const [pagePalette, setPagePalette] = useState<PagePalette>(() => getSavedPagePalette());
    const selectPageBackground = (pattern: PagePattern, palette: PagePalette) => {
        setPagePattern(pattern);
        setPagePalette(palette);
        applyPageBackground(pattern, palette, true);
    };
    const [pieceSetKey, setPieceSetKey] = useState(() => getSavedPieceSetKey());
    // Отдельная тема для разбора партий (таск 18.3): комплект (доска и фигуры) или «как в игре».
    const [analysisPreset, setAnalysisPreset] = useState<string>(() => (hasAnalysisAppearance()
        ? THEME_PRESETS.find((p) => p.board === getAnalysisBoardThemeKey())?.id ?? 'custom' : 'same'));
    const chooseAnalysisPreset = (id: string) => {
        setAnalysisPreset(id);
        const preset = THEME_PRESETS.find((p) => p.id === id);
        setAnalysisAppearance(preset?.board ?? null, preset?.pieces ?? null);
    };
    const [isMuted, setIsMuted] = useState(() => soundEngine.isMuted());
    // Темы-комплекты (таск 18.3): комплект «выбран», пока все его части совпадают с текущими настройками.
    const [soundSet, setSoundSetState] = useState<SoundSetId>(() => soundEngine.getSoundSet());
    const activePreset = THEME_PRESETS.find((p) => p.board === boardThemeKey && p.pieces === pieceSetKey
        && p.pattern === pagePattern && p.palette === pagePalette && p.sound === soundSet);
    const choosePreset = (preset: ThemePreset) => {
        applyPreset(preset);
        setBoardThemeKey(preset.board);
        setPieceSetKey(preset.pieces);
        setPagePattern(preset.pattern);
        setPagePalette(preset.palette);
        setSoundSetState(preset.sound);
        if (token) saveProfileSettings({theme_preset: preset.id}).catch(() => undefined);
    };
    const chooseSoundSet = (id: SoundSetId) => {
        soundEngine.setSoundSet(id);
        setSoundSetState(id);
        soundEngine.play('move');
    };

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
    // E-mail (таск 17.5): необязателен, нужен для сброса пароля; привязывается по ссылке из письма.
    const [email, setEmail] = useState<string | null>(null);
    const [emailInput, setEmailInput] = useState('');
    const [emailPassword, setEmailPassword] = useState('');
    const [emailNotice, setEmailNotice] = useState<UiMessage | null>(null);
    const [emailError, setEmailError] = useState<UiMessage | null>(null);
    // Режим «помощник перевода» (таск 17.7) — хранится в профиле.
    const [helper, setHelper] = useState(false);
    // Аватар из собственного набора (таск 18.4) — хранится в профиле.
    const [avatar, setAvatar] = useState<string | null>(null);

    useEffect(() => {
        if (!token) return;
        void (async () => {
            try {
                const res = await fetch(`${API_BASE_URL}/api/v1/profile/me`, {headers: {Authorization: `Bearer ${token}`}});
                if (res?.ok) {
                    const me = await res.json();
                    setEmail(me?.email ?? null);
                    setHelper(!!me?.translation_helper);
                    setAvatar(me?.avatar ?? null);
                }
            } catch {
                // Не удалось узнать адрес — раздел покажет «не привязан», привязать можно всё равно.
            }
        })();
    }, [token]);

    const emailRequest = async (path: string, body: object, onOk: () => void, fallback: 'settings.emailFailed') => {
        if (!token) return;
        setEmailError(null);
        setEmailNotice(null);
        try {
            const res = await fetch(`${API_BASE_URL}/api/v1/account/${path}`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json', Authorization: `Bearer ${token}`},
                body: JSON.stringify(body),
            });
            if (!res.ok) {
                setEmailError(await readApiErrorOr(res, fallback));
                return;
            }
            setEmailPassword('');
            onOk();
        } catch {
            setEmailError({key: 'common.noConnection'});
        }
    };

    const sendEmailLink = (e: React.FormEvent) => {
        e.preventDefault();
        const address = emailInput.trim();
        void emailRequest('email', {email: address, password: emailPassword, language},
            () => setEmailNotice({key: 'settings.emailSent', params: {email: address}}), 'settings.emailFailed');
    };

    const removeEmail = () => {
        void emailRequest('email/remove', {password: emailPassword}, () => {
            setEmail(null);
            setEmailNotice({key: 'settings.emailRemoved'});
        }, 'settings.emailFailed');
    };

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
            clearToken();
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
                credentials: 'include',  // новая refresh-cookie: прежние сессии отозваны (таск 17.5)
            });
            if (!res.ok) {
                setPasswordError(await readApiErrorOr(res, 'settings.passwordChangeFailed'));
                return;
            }
            const data = await res.json();
            setToken(data.access_token);
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

            {token && username && (
                <section className={sectionClass}>
                    <h2 className={headingClass}><Palette size={18} className="text-amber-400"/> {t('settings.avatar')}</h2>
                    <AvatarPicker username={username} value={avatar} onChange={(code) => {
                        setAvatar(code);
                        saveProfileSettings({avatar: code}).catch(() => undefined);
                    }}/>
                </section>
            )}

            <section className={sectionClass} data-testid="theme-presets">
                <h2 className={headingClass}><Palette size={18} className="text-amber-400"/> {t('settings.presets')}</h2>
                <p className="text-sm text-boxwood/75 mb-3">{t('settings.presetsHint')}</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {THEME_PRESETS.map((preset) => (
                        <button
                            key={preset.id}
                            type="button"
                            aria-pressed={activePreset?.id === preset.id}
                            data-testid={`preset-${preset.id}`}
                            onClick={() => choosePreset(preset)}
                            className={`${optionClass(activePreset?.id === preset.id)} flex-col items-stretch`}
                        >
                            <ThemePreview preset={preset}/>
                            <span className="font-bold">{t(`settings.presetNames.${preset.id}.name`)}</span>
                            <span className="text-xs text-boxwood/70">{t(`settings.presetNames.${preset.id}.description`)}</span>
                        </button>
                    ))}
                </div>
            </section>

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

                <label className="flex flex-wrap items-center gap-2 text-sm mt-4">
                    <span className="text-xs uppercase tracking-wider text-boxwood/65 font-bold">{t('settings.analysisTheme')}</span>
                    <select value={analysisPreset} onChange={(e) => chooseAnalysisPreset(e.target.value)} data-testid="analysis-theme"
                            className="bg-black/40 border border-amber-900/60 rounded px-2 py-1 text-boxwood-light">
                        <option value="same">{t('settings.analysisSame')}</option>
                        {analysisPreset === 'custom' && <option value="custom">{t('settings.analysisCustom')}</option>}
                        {THEME_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{t(`settings.presetNames.${preset.id}.name`)}</option>)}
                    </select>
                </label>

                <div className="text-xs uppercase tracking-wider text-boxwood/65 font-bold mb-1.5 mt-4">{t('settings.pageBackground')}</div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2" data-testid="page-patterns">
                    {PAGE_PATTERNS.map((pattern) => (
                        <button
                            key={pattern}
                            type="button"
                            aria-pressed={pagePattern === pattern}
                            onClick={() => selectPageBackground(pattern, pagePalette)}
                            className={optionClass(pagePattern === pattern)}
                        >
                            <span className="w-9 h-9 rounded shrink-0 border border-black/50" style={pageBackgroundStyle(pattern, pagePalette)}/>
                            <span className="truncate">{t(`settings.pagePatterns.${pattern}`)}</span>
                        </button>
                    ))}
                </div>
                <div className="flex flex-wrap gap-2" data-testid="page-palettes">
                    {(Object.keys(PAGE_PALETTES) as PagePalette[]).map((palette) => (
                        <button
                            key={palette}
                            type="button"
                            aria-pressed={pagePalette === palette}
                            onClick={() => selectPageBackground(pagePattern, palette)}
                            className={optionClass(pagePalette === palette)}
                        >
                            <span className="w-5 h-5 rounded-full shrink-0 border border-black/50" style={{backgroundColor: PAGE_PALETTES[palette]}}/>
                            <span>{t(`settings.pagePalettes.${palette}`)}</span>
                        </button>
                    ))}
                </div>
            </section>

            <section className={sectionClass}>
                <h2 className={headingClass}><Languages size={18} className="text-amber-400"/> {t('settings.language')}</h2>
                <LanguageSwitcher/>
                {token && (
                    <label className="flex items-start gap-2 text-sm mt-1 cursor-pointer">
                        <input type="checkbox" checked={helper} data-testid="translation-helper-toggle" className="mt-1"
                               onChange={(e) => {
                                   const value = e.target.checked;
                                   setHelper(value);
                                   setTranslationHelper(value);
                                   saveProfileSettings({translation_helper: value}).catch(() => undefined);
                               }}/>
                        <span>
                            <span className="font-bold">{t('translationHelper.setting')}</span>
                            <span className="block text-xs text-boxwood/70">{t('translationHelper.settingHint')}</span>
                        </span>
                    </label>
                )}
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
                <div className="flex flex-wrap gap-2 mt-3" data-testid="sound-sets">
                    {(Object.keys(SOUND_SETS) as SoundSetId[]).map((id) => (
                        <button key={id} type="button" aria-pressed={soundSet === id} disabled={isMuted}
                                onClick={() => chooseSoundSet(id)} className={`${optionClass(soundSet === id)} disabled:opacity-40`}>
                            {t(`settings.soundSets.${id}`)}
                        </button>
                    ))}
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

                    <section className={sectionClass} data-testid="settings-email">
                        <h2 className={headingClass}><AtSign size={18} className="text-amber-400"/> {t('settings.email')}</h2>
                        <p className="text-sm text-boxwood/80 mb-2 max-w-xl">{t('settings.emailNote')}</p>
                        <p className="text-sm mb-3" data-testid="settings-email-current">
                            {email ? t('settings.emailCurrent', {email}) : t('settings.emailNone')}
                        </p>
                        <form onSubmit={sendEmailLink} className="flex flex-col gap-2 max-w-sm">
                            <input type="email" autoComplete="email" value={emailInput} required
                                   onChange={(e) => setEmailInput(e.target.value)} className={inputClass}
                                   placeholder={t(email ? 'settings.emailChange' : 'settings.email')}
                                   data-testid="settings-email-input"/>
                            <input type="password" autoComplete="current-password" value={emailPassword}
                                   onChange={(e) => setEmailPassword(e.target.value)} className={inputClass}
                                   placeholder={t('settings.currentPassword')} data-testid="settings-email-password"/>
                            <div className="flex flex-wrap gap-2">
                                <button type="submit" disabled={!emailInput.trim() || !emailPassword} data-testid="settings-email-send"
                                        className="px-4 py-2 rounded-md bg-amber-800 hover:bg-amber-700 text-white text-sm font-bold transition cursor-pointer disabled:opacity-40">
                                    {t('settings.emailSend')}
                                </button>
                                {email && (
                                    <button type="button" onClick={removeEmail} disabled={!emailPassword} data-testid="settings-email-remove"
                                            className="px-4 py-2 rounded-md bg-black/40 border border-amber-900/50 text-sm font-bold cursor-pointer disabled:opacity-40">
                                        {t('settings.emailRemove')}
                                    </button>
                                )}
                            </div>
                        </form>
                        {emailNotice && <p className="text-sm text-emerald-300 mt-2" role="status">{renderUiMessage(emailNotice, t)}</p>}
                        {emailError && <p className="text-sm text-red-300 mt-2" role="alert">{renderUiMessage(emailError, t)}</p>}
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
