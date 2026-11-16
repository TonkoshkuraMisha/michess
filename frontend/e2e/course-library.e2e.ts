// Большой курс, библиотека и новые тренажёры в настоящем браузере против полного стека (таски 27.5–27.12), гостем —
// без регистрации (её лимит на IP расходуют другие сценарии). База библиотеки в стеке пустая: «Узнай структуру»
// отвечает учебными скелетами, «Миниатюры» — пустым набором.

import {expect, test} from '@playwright/test';

test('Большой курс: уровни, ветви, каркас и переход в раздел', async ({page}) => {
    await page.goto('/learn');
    await page.getByTestId('learn-course-link').click();
    await expect(page.getByTestId('supercourse-page')).toBeVisible();
    await expect(page.getByTestId('course-module-T0.0')).toContainText('Доска, фигуры и взятие');
    await page.getByTestId('course-level-3').click();
    await expect(page.getByTestId('course-module-S3.5')).toContainText('«Пила»');
    // Все модули наполнены (27.6): бывший пустой T3.2 виден и без режима «каркас»; сам режим проверяет юнит-тест.
    await expect(page.getByTestId('course-module-T3.2')).toContainText('Завоевание поля');
    await page.getByTestId('course-module-S3.5').getByRole('button').first().click();
    await expect(page).toHaveURL(/\/library\?structure=saw/);
    await expect(page.getByTestId('library-structure')).toHaveValue('saw');
});

test('«Узнай структуру»: десять вопросов со скелетами, итог', async ({page}) => {
    await page.goto('/train/structure_quiz');
    await page.getByTestId('trainer-start').click();
    await expect(page.getByTestId('structure-quiz')).toBeVisible();
    for (let i = 0; i < 10; i++) {
        await page.locator('[data-testid^="quiz-option-"]').first().click();
        await page.getByTestId('quiz-next').click();
    }
    await expect(page.getByTestId('trainer-result')).toBeVisible();
});

test('эндшпиль: обязательные позиции и этюды на странице тренажёра', async ({page}) => {
    await page.goto('/learn/endgames');
    await expect(page.getByTestId('must-know-1')).toContainText('Ступень 1');
    await expect(page.getByTestId('endgame-study_saavedra')).toBeVisible();
    await page.getByTestId('endgame-vancura').click();
    await expect(page.locator('[data-square="a8"]').first()).toBeVisible();
});
