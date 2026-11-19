// --- FILE: frontend/src/components/social/FeedPage.tsx ---
// Лента и публикации (таск 30.2): /feed — поле публикации и лента подписок; /feed/post/:postId — публикация с
// комментариями; ProfilePosts — публикации игрока в профиле. Поделиться из другой страницы:
// navigate('/feed', {state: {attach: {kind, ref}}}) — поле публикации откроется с готовой карточкой.
// Данные: services/feed.ts — feedApi (GET /api/v1/feed — лента подписок, /feed/user/{имя}, /feed/posts/{id}, публикация,
// лайк, комментарии; src/api/feed.py). Текст публикации — до 2000 знаков, комментария — до 500 (как BODY_MAX и COMMENT_MAX
// в src/services/feed.py); страница ленты — по 20 публикаций с подгрузкой «ещё». Фильтр оскорблений и придержанные
// тексты — Civility.tsx. Роуты — App.tsx; ProfilePosts рисует Profile.tsx.

import {useCallback, useEffect, useState} from 'react';
import type {FormEvent} from 'react';
import {Link, useLocation, useNavigate, useParams} from 'react-router-dom';
import {ArrowLeft, Heart, MessageCircle, Newspaper, Paperclip, Send, Trash2, X} from 'lucide-react';
import {renderUiMessage, useI18n} from '../../i18n';
import type {UiMessage} from '../../i18n';
import {errorMessage} from '../../services/apiErrors';
import {getToken} from '../../services/authToken';
import {feedApi} from '../../services/feed';
import type {Post, PostComment} from '../../services/feed';
import {detectAttachment} from '../../services/messages';
import type {AttachmentKind} from '../../services/messages';
import {AttachmentCard} from './AttachmentCard';
import {FlaggedNotice, HeldNote, isTextFlagged, RulesLink, TextReportButton} from './Civility';

// Виды вложений, выбираемые вручную; достижение добавляется только кнопкой «поделиться» в профиле.
const KINDS: AttachmentKind[] = ['game', 'position', 'puzzle', 'lesson', 'tournament', 'library'];

/** Черновик вложения: вид и ссылка или идентификатор (ref); приходит и из location.state.attach. */
interface Draft {
    kind: AttachmentKind;
    ref: string;
}

/** Дата и время публикации в локали игрока. */
function when(iso: string | null, code: string): string {
    return iso ? new Date(iso).toLocaleString(code, {dateStyle: 'short', timeStyle: 'short'}) : '';
}

/** Поле новой публикации с вложением; при отказе фильтра показывает FlaggedNotice и позволяет отправить на проверку. */
export function Composer({initial, onPosted}: { initial: Draft | null; onPosted: (post: Post) => void }) {
    const {t} = useI18n();
    const [body, setBody] = useState('');
    const [draft, setDraft] = useState<Draft | null>(initial);
    const [attachOpen, setAttachOpen] = useState(Boolean(initial));
    const [sending, setSending] = useState(false);
    const [error, setError] = useState<UiMessage | null>(null);
    const [flagged, setFlagged] = useState(false);

    const submit = (e?: FormEvent, sendAnyway = false) => {
        e?.preventDefault();
        const attachment = draft && draft.ref.trim() ? {kind: draft.kind, ref: draft.ref.trim()} : null;
        if (sending || (!body.trim() && !attachment)) return;
        setSending(true);
        setFlagged(false);
        feedApi.create(body, attachment, sendAnyway).then((post) => {
            setBody('');
            setDraft(null);
            setAttachOpen(false);
            setError(null);
            onPosted(post);
        }).catch((err) => {
            if (isTextFlagged(err)) setFlagged(true);
            else setError(errorMessage(err, 'common.networkError'));
        }).finally(() => setSending(false));
    };

    return (
        <form onSubmit={(e) => submit(e)} className="flex flex-col gap-2 bg-black/20 rounded-md p-2 border border-amber-900/40" data-testid="feed-composer">
            {flagged && <FlaggedNotice onRephrase={() => setFlagged(false)} onSendAnyway={() => submit(undefined, true)}/>}
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} maxLength={2000} placeholder={t('feed.placeholder')}
                      data-testid="feed-input" className="w-full bg-black/40 rounded px-2 py-1 text-sm resize-y"/>
            {attachOpen && (
                <div className="flex flex-wrap items-center gap-1.5 text-sm" data-testid="feed-attach">
                    {draft?.kind === 'achievement' ? (
                        <span className="px-1.5 py-1">{t('dm.kinds.achievement')}</span>
                    ) : (
                        <>
                            <select value={draft?.kind ?? 'game'} className="bg-black/40 rounded px-1.5 py-1" data-testid="feed-attach-kind"
                                    onChange={(e) => setDraft({kind: e.target.value as AttachmentKind, ref: draft?.ref ?? ''})}>
                                {KINDS.map((k) => <option key={k} value={k}>{t(`dm.kinds.${k}`)}</option>)}
                            </select>
                            <input value={draft?.ref ?? ''} maxLength={200} placeholder={t('dm.attachHint')} data-testid="feed-attach-ref"
                                   className="flex-1 min-w-0 bg-black/40 rounded px-2 py-1"
                                   onChange={(e) => {
                                       const found = detectAttachment(e.target.value);
                                       setDraft(found ?? {kind: draft?.kind ?? 'game', ref: e.target.value});
                                   }}/>
                        </>
                    )}
                    <button type="button" onClick={() => {
                        setDraft(null);
                        setAttachOpen(false);
                    }} aria-label={t('dm.removeAttachment')} title={t('dm.removeAttachment')} className="p-1 text-boxwood/70">
                        <X size={14}/>
                    </button>
                </div>
            )}
            {draft?.kind === 'achievement' && draft.ref && <AttachmentCard attachment={{kind: 'achievement', ref: draft.ref}}/>}
            {error && <p role="alert" className="text-sm text-rose-300">{renderUiMessage(error, t)}</p>}
            <div className="flex items-center justify-between gap-2">
                <button type="button" onClick={() => setAttachOpen((v) => !v)} data-testid="feed-attach-toggle"
                        className="flex items-center gap-1 text-sm text-boxwood/80 hover:text-amber-300">
                    <Paperclip size={15}/> {t('dm.attach')}
                </button>
                <button type="submit" disabled={sending} data-testid="feed-publish"
                        className="px-3 py-1 rounded bg-amber-700 text-white font-bold text-sm flex items-center gap-1 disabled:opacity-50">
                    <Send size={14}/> {t('feed.publish')}
                </button>
            </div>
        </form>
    );
}

/** Публикация: автор, текст, вложение, лайк, комментарии, жалоба (чужая) или удаление (своя); linkToPost — ссылка на страницу публикации. */
export function PostCard({post, onChange, onRemoved, linkToPost = true}: {
    post: Post;
    onChange: (post: Post) => void;
    onRemoved: (id: number) => void;
    linkToPost?: boolean;
}) {
    const {t, dateLocale} = useI18n();
    const loggedIn = Boolean(getToken());
    const remove = () => {
        if (!window.confirm(t('feed.deleteConfirm'))) return;
        feedApi.remove(post.id).then(() => onRemoved(post.id)).catch(() => undefined);
    };
    return (
        <article className="bg-black/25 border border-amber-900/40 rounded-md p-3 flex flex-col gap-1.5" data-testid="feed-post">
            <header className="flex items-center justify-between gap-2 text-sm">
                {post.author ? (
                    <Link to={`/profile/${encodeURIComponent(post.author)}`} className="font-bold hover:underline truncate">{post.author}</Link>
                ) : <span/>}
                <span className="text-xs text-boxwood/60 shrink-0">{when(post.created_at, dateLocale.code)}</span>
            </header>
            {post.hidden && <p className="text-xs text-rose-300" data-testid="feed-hidden">{t('feed.hidden')}</p>}
            {post.held && <HeldNote/>}
            {post.body && <p className="whitespace-pre-wrap break-words text-sm">{post.body}</p>}
            {post.attachment && <AttachmentCard attachment={post.attachment}/>}
            <footer className="flex items-center gap-4 text-sm text-boxwood/80 mt-1">
                <button type="button" disabled={!loggedIn} aria-pressed={post.liked} aria-label={t('feed.like')} title={t('feed.like')}
                        data-testid="feed-like" onClick={() => feedApi.like(post.id, !post.liked).then(onChange).catch(() => undefined)}
                        className={`flex items-center gap-1 ${post.liked ? 'text-rose-400' : 'hover:text-rose-300'} disabled:opacity-60`}>
                    <Heart size={15} fill={post.liked ? 'currentColor' : 'none'}/> {post.likes}
                </button>
                {linkToPost ? (
                    <Link to={`/feed/post/${post.id}`} className="flex items-center gap-1 hover:text-amber-300" data-testid="feed-comments-link"
                          title={t('feed.open')}>
                        <MessageCircle size={15}/> {t('feed.comments', {count: post.comments})}
                    </Link>
                ) : (
                    <span className="flex items-center gap-1"><MessageCircle size={15}/> {t('feed.comments', {count: post.comments})}</span>
                )}
                {!post.mine && loggedIn && <span className="ml-auto"><TextReportButton subject={`post:${post.id}`}/></span>}
                {post.mine && (
                    <button type="button" onClick={remove} className="ml-auto flex items-center gap-1 text-xs text-rose-300 hover:underline"
                            data-testid="feed-delete">
                        <Trash2 size={13}/> {t('feed.delete')}
                    </button>
                )}
            </footer>
        </article>
    );
}

/** Постраничная загрузка списка публикаций: страница заканчивается, когда сервер вернул меньше page штук; load(beforeId) берёт более ранние. */
function usePostList(load: (beforeId?: number) => Promise<{ posts: Post[]; page: number }>) {
    const [posts, setPosts] = useState<Post[] | null>(null);
    const [more, setMore] = useState(false);

    useEffect(() => {
        let alive = true;
        setPosts(null);
        load().then((r) => {
            if (!alive) return;
            setPosts(r.posts);
            setMore(r.posts.length >= r.page);
        }).catch(() => alive && setPosts([]));
        return () => {
            alive = false;
        };
    }, [load]);

    const loadMore = () => {
        const last = posts?.[posts.length - 1];
        if (!last) return;
        load(last.id).then((r) => {
            setPosts((prev) => [...(prev ?? []), ...r.posts]);
            setMore(r.posts.length >= r.page);
        }).catch(() => undefined);
    };
    const replace = (post: Post) => setPosts((prev) => prev && prev.map((p) => (p.id === post.id ? post : p)));
    const drop = (id: number) => setPosts((prev) => prev && prev.filter((p) => p.id !== id));
    const prepend = (post: Post) => setPosts((prev) => [post, ...(prev ?? [])]);
    return {posts, more, loadMore, replace, drop, prepend};
}

/** Список публикаций с кнопкой «ещё» и подписью для пустого списка. */
function PostList({list, emptyKey}: { list: ReturnType<typeof usePostList>; emptyKey: 'feed.empty' | 'feed.noProfilePosts' }) {
    const {t} = useI18n();
    if (!list.posts) return null;
    if (list.posts.length === 0) return <p className="text-sm text-boxwood/70" data-testid="feed-empty">{t(emptyKey)}</p>;
    return (
        <div className="flex flex-col gap-3" data-testid="feed-list">
            {list.posts.map((p) => <PostCard key={p.id} post={p} onChange={list.replace} onRemoved={list.drop}/>)}
            {list.more && (
                <button type="button" onClick={list.loadMore} className="self-center text-sm text-amber-300 hover:underline" data-testid="feed-more">
                    {t('feed.more')}
                </button>
            )}
        </div>
    );
}

/** Лента подписок и поле публикации; требует входа. */
export function FeedPage() {
    const {t} = useI18n();
    const location = useLocation();
    const navigate = useNavigate();
    const initial = (location.state as { attach?: Draft } | null)?.attach ?? null;
    const load = useCallback((beforeId?: number) => feedApi.following(beforeId), []);
    const list = usePostList(load);

    if (!getToken()) return <p className="p-6 text-center text-boxwood/80" data-testid="feed-login">{t('feed.loginRequired')}</p>;

    return (
        <div className="max-w-2xl mx-auto w-full px-4 py-4 flex flex-col gap-3" data-testid="feed-page">
            <h1 className="text-xl font-bold flex items-center gap-2"><Newspaper size={20}/> {t('feed.title')}</h1>
            <p className="text-sm text-boxwood/70 flex flex-wrap items-center justify-between gap-2">{t('feed.intro')} <RulesLink/></p>
            <Composer initial={initial} onPosted={(post) => {
                list.prepend(post);
                if (initial) navigate(location.pathname, {replace: true, state: null});
            }}/>
            <PostList list={list} emptyKey="feed.empty"/>
        </div>
    );
}

/** Публикация с комментариями. Придержанный комментарий в счётчик не входит. */
export function PostPage() {
    const {t, dateLocale} = useI18n();
    const {postId} = useParams<{ postId: string }>();
    const navigate = useNavigate();
    const [post, setPost] = useState<Post | null>(null);
    const [comments, setComments] = useState<PostComment[]>([]);
    const [error, setError] = useState<UiMessage | null>(null);
    const [body, setBody] = useState('');
    const [flagged, setFlagged] = useState(false);
    const id = Number(postId);

    useEffect(() => {
        feedApi.get(id).then((r) => {
            setPost(r.post);
            setComments(r.comments);
        }).catch((err) => setError(errorMessage(err, 'common.networkError')));
    }, [id]);

    const send = (e?: FormEvent, sendAnyway = false) => {
        e?.preventDefault();
        if (!body.trim()) return;
        setFlagged(false);
        feedApi.comment(id, body, sendAnyway).then((c) => {
            setComments((prev) => [...prev, c]);
            if (!c.held) setPost((prev) => prev && {...prev, comments: prev.comments + 1});
            setBody('');
            setError(null);
        }).catch((err) => {
            if (isTextFlagged(err)) setFlagged(true);
            else setError(errorMessage(err, 'common.networkError'));
        });
    };

    const removeComment = (commentId: number) => feedApi.removeComment(commentId).then(() => {
        setComments((prev) => prev.filter((c) => c.id !== commentId));
        setPost((prev) => prev && {...prev, comments: Math.max(0, prev.comments - 1)});
    }).catch(() => undefined);

    return (
        <div className="max-w-2xl mx-auto w-full px-4 py-4 flex flex-col gap-3" data-testid="post-page">
            <Link to="/feed" className="text-sm text-amber-300 hover:underline flex items-center gap-1"><ArrowLeft size={14}/> {t('feed.back')}</Link>
            {post && <PostCard post={post} onChange={setPost} onRemoved={() => navigate('/feed')} linkToPost={false}/>}
            {post && (
                <section className="flex flex-col gap-2" data-testid="post-comments">
                    {comments.length === 0 && <p className="text-sm text-boxwood/60">{t('feed.noComments')}</p>}
                    {comments.map((c) => (
                        <div key={c.id} className="bg-black/20 rounded px-3 py-1.5 text-sm" data-testid="post-comment">
                            <div className="flex items-center justify-between gap-2 text-xs text-boxwood/60">
                                {c.author ? <Link to={`/profile/${encodeURIComponent(c.author)}`} className="font-bold text-boxwood/90 hover:underline">{c.author}</Link> : <span/>}
                                <span className="flex items-center gap-2">
                                    {when(c.created_at, dateLocale.code)}
                                    {c.can_delete && (
                                        <button type="button" onClick={() => void removeComment(c.id)} aria-label={t('feed.delete')} title={t('feed.delete')}
                                                className="text-rose-300"><Trash2 size={12}/></button>
                                    )}
                                </span>
                            </div>
                            <p className="whitespace-pre-wrap break-words">{c.body}</p>
                            {c.held && <HeldNote/>}
                            {!c.mine && getToken() && <TextReportButton subject={`comment:${c.id}`}/>}
                        </div>
                    ))}
                    {flagged && <FlaggedNotice onRephrase={() => setFlagged(false)} onSendAnyway={() => send(undefined, true)}/>}
                    {getToken() && (
                        <form onSubmit={(e) => send(e)} className="flex items-end gap-2" data-testid="comment-form">
                            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={2} maxLength={500}
                                      placeholder={t('feed.commentPlaceholder')} data-testid="comment-input"
                                      className="flex-1 min-w-0 bg-black/40 rounded px-2 py-1 text-sm resize-none"/>
                            <button type="submit" className="px-3 py-1.5 rounded bg-amber-700 text-white text-sm" data-testid="comment-send">
                                {t('feed.comment')}
                            </button>
                        </form>
                    )}
                </section>
            )}
            {error && <p role="alert" className="text-sm text-rose-300">{renderUiMessage(error, t)}</p>}
        </div>
    );
}

/** Публикации игрока в профиле. */
export function ProfilePosts({username}: { username: string }) {
    const {t} = useI18n();
    const load = useCallback((beforeId?: number) => feedApi.ofUser(username, beforeId), [username]);
    const list = usePostList(load);
    return (
        <section className="flex flex-col gap-2" data-testid="profile-posts">
            <h2 className="font-bold text-amber-200 flex items-center gap-1.5"><Newspaper size={16}/> {t('feed.profilePosts')}</h2>
            <PostList list={list} emptyKey="feed.noProfilePosts"/>
        </section>
    );
}
