// --- FILE: frontend/src/test/newGame.ts ---
// Помощники тестов игрового зала: окно «Новая партия» (схема владельца 18.11) на шаге «Начать». Выбор соперника
// запоминается в localStorage (regence_new_game_who), поэтому окно открывается сразу на старте — как у игрока, который
// уже начинал такую партию. Первый проход по шагам проверяет отдельный тест в Chessboard.test.tsx.

import {fireEvent, screen} from '@testing-library/react';

async function openNewGame(who: 'human' | 'bot') {
    localStorage.setItem('regence_new_game_who', who);
    fireEvent.click(await screen.findByTestId('new-game-open'));
}

/** Окно на шаге с ботами: исторические мастера, мастерская, лестница. */
export const openBots = () => openNewGame('bot');

/** Окно на шаге с человеком: тип партии, поиск соперника, вызов друга. */
export const openHuman = () => openNewGame('human');
