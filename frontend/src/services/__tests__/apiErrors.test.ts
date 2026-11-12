// --- FILE: frontend/src/services/__tests__/apiErrors.test.ts ---
// Ошибки сервера на языке игрока: код → каталог serverErrors, ошибки проверки полей (422) → каталог
// validation с названием поля, незнакомый код → английский текст сервера, исключения сервисов → UiError.

import {describe, expect, it} from 'vitest';
import {makeI18n, renderUiMessage, type Language} from '../../i18n';
import {
    UiError,
    apiErrorMessage,
    errorMessage,
    readApiError,
    readApiErrorOr,
    serverErrorMessage,
} from '../apiErrors';

const render = (detail: unknown, language: Language = 'ru') => {
    const message = apiErrorMessage(detail);
    return message ? renderUiMessage(message, makeI18n(language).t) : null;
};

const jsonResponse = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});

describe('ошибка сервера с кодом', () => {
    const detail = {
        code: 'rating_out_of_range',
        params: {rating: 1500, min: 1600, max: 1800},
        message: 'Your rating 1500 is outside the challenge range (1600–1800)',
    };

    it('текст берётся из каталога на языке игрока, с параметрами', () => {
        expect(render(detail, 'ru')).toBe('Ваш рейтинг 1500 вне диапазона вызова (1600–1800)');
        expect(render(detail, 'uk')).toBe('Ваш рейтинг 1500 поза діапазоном виклику (1600–1800)');
        expect(render(detail, 'en')).toBe('Your rating 1500 is outside the challenge range (1600–1800)');
    });

    it('незнакомый код — английский текст сервера', () => {
        expect(render({code: 'brand_new_code', params: {}, message: 'Something new'})).toBe('Something new');
    });

    it('без кода и текста — ничего (покажется запасное сообщение)', () => {
        expect(apiErrorMessage({code: 'brand_new_code'})).toBeNull();
        expect(apiErrorMessage(undefined)).toBeNull();
        expect(apiErrorMessage([])).toBeNull();
    });

    it('стандартная ошибка FastAPI без кода показывается как есть', () => {
        expect(render('Not Found')).toBe('Not Found');
    });

    it('параметры — только простые значения', () => {
        const message = serverErrorMessage('user_not_found', {username: 'alice', extra: {nested: 1}});
        expect(message).toEqual({key: 'serverErrors.user_not_found', params: {username: 'alice'}});
    });
});

describe('ошибки проверки полей (422)', () => {
    it('своя проверка сервера — по коду и с названием поля', () => {
        const detail = [{type: 'username_mixed_scripts', loc: ['body', 'username'], msg: '…', params: {}}];
        expect(render(detail, 'ru')).toBe('Имя пользователя: Имя не может смешивать латиницу и кириллицу');
        expect(render(detail, 'en')).toBe('Username: A name cannot mix Latin and Cyrillic letters');
    });

    it('стандартная проверка — по типу из каталога validation', () => {
        const detail = [{type: 'string_too_short', loc: ['body', 'password'], msg: 'String should…', params: {min_length: 8}}];
        expect(render(detail, 'ru')).toBe('Пароль: не короче 8 символов');
        expect(render(detail, 'uk')).toBe('Пароль: щонайменше 8 символів');
    });

    it('незнакомое поле — по имени, незнакомая проверка — «некорректное значение»', () => {
        const detail = [{type: 'some_pydantic_type', loc: ['body', 'weird_field'], msg: 'Weird', params: {}}];
        expect(render(detail, 'ru')).toBe('weird_field: некорректное значение');
    });

    it('проверка модели целиком — без названия поля', () => {
        const detail = [{type: 'config_or_personality', loc: ['body'], msg: '…', params: {}}];
        expect(render(detail, 'en')).toBe('Specify either the opponent’s settings or a saved opponent, not both');
    });
});

describe('чтение ответа', () => {
    it('readApiError разбирает тело ответа', async () => {
        const message = await readApiError(jsonResponse(404, {detail: {code: 'game_not_found', params: {game_id: 7}, message: '…'}}));
        expect(message).toEqual({key: 'serverErrors.game_not_found', params: {game_id: 7}});
    });

    it('тело не JSON — запасное сообщение', async () => {
        expect(await readApiError(new Response('<html>502</html>', {status: 502}))).toBeNull();
        expect(await readApiErrorOr(new Response('', {status: 500}), 'viewer.analysisFailed'))
            .toEqual({key: 'viewer.analysisFailed'});
    });
});

describe('исключения', () => {
    it('UiError несёт сообщение, остальное — запасное', () => {
        const ui = {key: 'serverErrors.personality_duplicate' as const};
        expect(errorMessage(new UiError(ui), 'workshop.saveFailed')).toBe(ui);
        expect(errorMessage(new TypeError('Failed to fetch'), 'workshop.saveFailed')).toEqual({key: 'workshop.saveFailed'});
    });
});
