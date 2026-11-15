// --- FILE: frontend/src/i18n/glossary.ts ---
// Единый словарь шахматных терминов на трёх языках (таск 17.7). Правило: термин в каталогах пишется так, как здесь,
// а не одним из вариантов в `avoid` (регулярные выражения без учёта регистра, совпадение с начала слова). Тест —
// i18n/__tests__/glossary.test.ts; лежит в messages/, потому что это тоже текст. Добавляя термин, сначала проверьте, как он уже написан в каталогах.

import type {Language} from '../core';

export interface GlossaryTerm {
    id: string;
    en: string;
    uk: string;
    ru: string;
    /** Неверные или нежелательные написания по языкам. */
    avoid?: Partial<Record<Language, string[]>>;
}

export const GLOSSARY: GlossaryTerm[] = [
    {id: 'king', en: 'king', uk: 'король', ru: 'король'},
    {
        id: 'queen', en: 'queen', uk: 'ферзь', ru: 'ферзь',
        // «Королева» — разговорное; «королевский фланг» — законный термин, его не задевает.
        avoid: {uk: ['королев(а|у|ою|и|і)(?!\\p{L})'], ru: ['королев(а|у|ой|ы|е)(?!\\p{L})']},
    },
    {id: 'rook', en: 'rook', uk: 'тура', ru: 'ладья', avoid: {uk: ['ладд(я|і|ю|ею)'], en: ['castle piece']}},
    {id: 'bishop', en: 'bishop', uk: 'слон', ru: 'слон', avoid: {uk: ['офіцер'], ru: ['офицер']}},
    {id: 'knight', en: 'knight', uk: 'кінь', ru: 'конь', avoid: {ru: ['лошад'], en: ['horse']}},
    {id: 'pawn', en: 'pawn', uk: 'пішак', ru: 'пешка', avoid: {uk: ['пішк(а|у|ою|и|і)(?!\\p{L})', 'пєшк']}},
    {id: 'castling', en: 'castling', uk: 'рокіровка', ru: 'рокировка', avoid: {uk: ['рокировк'], ru: ['рокіровк']}},
    {
        id: 'en_passant', en: 'en passant', uk: 'взяття на проході', ru: 'взятие на проходе',
        avoid: {en: ['en-passant', 'enpassant', 'en passent']},
    },
    {id: 'promotion', en: 'promotion', uk: 'перетворення', ru: 'превращение', avoid: {uk: ['превращ', 'промоці'], ru: ['промоуш']}},
    {id: 'check', en: 'check', uk: 'шах', ru: 'шах'},
    {id: 'checkmate', en: 'checkmate', uk: 'мат', ru: 'мат', avoid: {en: ['check-mate', 'check mate']}},
    {id: 'stalemate', en: 'stalemate', uk: 'пат', ru: 'пат', avoid: {en: ['stale-mate', 'stale mate']}},
    {id: 'zugzwang', en: 'zugzwang', uk: 'цугцванг', ru: 'цугцванг', avoid: {uk: ['цугцвангу?ом'], en: ['zugswang']}},
    {id: 'opening', en: 'opening', uk: 'дебют', ru: 'дебют'},
    {id: 'middlegame', en: 'middlegame', uk: 'мітельшпіль', ru: 'миттельшпиль', avoid: {uk: ['міттельшп', 'миттельшп'], ru: ['мительшп'], en: ['middle game', 'middle-game']}},
    {id: 'endgame', en: 'endgame', uk: 'ендшпіль', ru: 'эндшпиль', avoid: {uk: ['эндшп', 'ендшпил'], ru: ['ендшп'], en: ['end game', 'end-game']}},
    {id: 'fork', en: 'fork', uk: 'вилка', ru: 'вилка'},
    {id: 'pin', en: 'pin', uk: 'зв’язка', ru: 'связка', avoid: {uk: ["зв'язк", 'звязк']}},
    {id: 'skewer', en: 'skewer', uk: 'лінійний удар', ru: 'сквозной удар', avoid: {uk: ['сквозн'], ru: ['линейн(ый|ого|ым) удар']}},
    {id: 'blunder', en: 'blunder', uk: 'груба помилка', ru: 'грубая ошибка'},
];
