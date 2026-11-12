// --- FILE: frontend/src/config/__tests__/players.test.ts ---
// Нейтральные имена с сервера (id ботов, общий соперник мастерской, ключи архетипов) и реплики ботов (ключи
// с параметрами) показываются на языке игрока; обычные имена игроков — как есть.

import {describe, expect, it} from 'vitest';
import {makeI18n, renderUiMessage} from '../../i18n';
import {displayPlayerName, ladderOpponentName} from '../players';
import {botCommentMessage} from '../../components/chessboard/hooks/useBotGame';

const en = makeI18n('en').t;
const uk = makeI18n('uk').t;
const ru = makeI18n('ru').t;

describe('имена игроков', () => {
    it('исторический бот — по id, в том числе служебное «_bot»', () => {
        expect(displayPlayerName('morphy', en)).toBe('Paul Morphy');
        expect(displayPlayerName('morphy', uk)).toBe('Пол Морфі');
        expect(displayPlayerName('philidor_bot', ru)).toBe('Ф.-А. Филидор');
    });

    it('общий соперник мастерской и архетип', () => {
        expect(displayPlayerName('workshop_opponent', en)).toBe('Workshop opponent');
        expect(displayPlayerName('archetype:rusher', en)).toBe('Rusher');
        expect(displayPlayerName('archetype:rusher', uk)).toBe('Квапко');
        expect(displayPlayerName('archetype:rusher', ru)).toBe('Торопыга');
    });

    it('обычные имена и незнакомые ключи — как есть', () => {
        expect(displayPlayerName('Misha_K', ru)).toBe('Misha_K');
        expect(displayPlayerName('archetype:unknown', ru)).toBe('archetype:unknown');
        expect(displayPlayerName(null, ru)).toBe('');
    });

    it('соперник ступени лестницы', () => {
        expect(ladderOpponentName('historical', 'paulsen', en)).toBe('Paulsen');
        expect(ladderOpponentName('archetype', 'quiet', uk)).toBe('Тихоня');
        expect(ladderOpponentName('archetype', 'quiet', en)).toBe('Quiet One');
    });
});

describe('реплики ботов', () => {
    it('ход из книги — фраза бота с числом партий архива', () => {
        const message = botCommentMessage({key: 'book.morphy', params: {games: 42}})!;
        expect(renderUiMessage(message, en)).toBe('A historical move of Paul Morphy (42 games in the archive).');
        expect(renderUiMessage(message, uk)).toBe('Історичний хід Пола Морфі (партій в архіві: 42).');
        expect(renderUiMessage(message, ru)).toBe('Исторический ход Пола Морфи (партий в архиве: 42).');
    });

    it('фирменная реплика стиля', () => {
        const message = botCommentMessage({key: 'philidor.pawnCenter', params: {}})!;
        expect(renderUiMessage(message, en)).toBe('Pawns are the soul of chess! A powerful thrust into the center.');
        expect(renderUiMessage(message, uk)).toBe('Пішаки — душа шахів! Потужний удар у центр дошки.');
    });

    it('незнакомый ключ, старый текстовый формат и мусор — без реплики', () => {
        expect(botCommentMessage({key: 'nobody.knows', params: {}})).toBeNull();
        expect(botCommentMessage('Старый текст')).toBeNull();
        expect(botCommentMessage(null)).toBeNull();
        expect(botCommentMessage({key: 5})).toBeNull();
    });

    it('параметры — только простые значения', () => {
        expect(botCommentMessage({key: 'book.paulsen', params: {games: 3, junk: {deep: 1}}}))
            .toEqual({key: 'botComments.book.paulsen', params: {games: 3}});
    });
});
