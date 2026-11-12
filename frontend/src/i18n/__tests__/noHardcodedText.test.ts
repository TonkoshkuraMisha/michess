// --- FILE: frontend/src/i18n/__tests__/noHardcodedText.test.ts ---
// Сторож правила «весь текст — в каталогах»: разбирает исходники токенизатором TypeScript и падает на любой
// кириллице в строках, шаблонах и тексте JSX вне каталогов. Комментарии пропускаются — они для разработчиков
// и пишутся по-русски. Новая строка интерфейса, вписанная прямо в компонент, этот тест уронит.

import {readdirSync, readFileSync} from 'node:fs';
import {join, relative, sep} from 'node:path';
import ts from 'typescript';
import {describe, expect, it} from 'vitest';

const SRC = join(__dirname, '..', '..');
const CYRILLIC = /[Ѐ-ӿ]/;

// Каталоги сообщений — единственное место для текста; тесты и тестовые утилиты пишутся по-русски.
const ALLOWED = [`i18n${sep}messages${sep}`, `${sep}__tests__${sep}`, `test${sep}`];

function sourceFiles(dir: string): string[] {
    return readdirSync(dir, {withFileTypes: true}).flatMap((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return sourceFiles(path);
        return /\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.d.ts') ? [path] : [];
    });
}

const TEXT_TOKENS = new Set([
    ts.SyntaxKind.StringLiteral,
    ts.SyntaxKind.NoSubstitutionTemplateLiteral,
    ts.SyntaxKind.TemplateHead,
    ts.SyntaxKind.TemplateMiddle,
    ts.SyntaxKind.TemplateTail,
    ts.SyntaxKind.JsxText,
]);

/** Строки с кириллицей в коде (не в комментариях): «файл:строка: текст». */
function hardcodedText(file: string): string[] {
    const text = readFileSync(file, 'utf-8');
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true,
        file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const found: string[] = [];
    const visit = (node: ts.Node) => {
        if (TEXT_TOKENS.has(node.kind) && CYRILLIC.test(node.getText(source))) {
            const {line} = source.getLineAndCharacterOfPosition(node.getStart(source));
            found.push(`${relative(SRC, file)}:${line + 1}: ${node.getText(source).trim().slice(0, 90)}`);
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    return found;
}

describe('текст интерфейса — только в каталогах', () => {
    it('в компонентах, хуках, сервисах и конфигах нет кириллицы вне комментариев', () => {
        const offenders = sourceFiles(SRC)
            .filter((file) => !ALLOWED.some((allowed) => file.includes(allowed)))
            .flatMap(hardcodedText);
        expect(offenders, `\n${offenders.join('\n')}`).toEqual([]);
    });

    it('сторож действительно находит текст в строке, шаблоне и JSX', () => {
        const probe = join(SRC, 'i18n', '__tests__', 'probe.tsx');
        const source = ts.createSourceFile(probe, [
            "// комментарий не считается",
            "const a = 'строка';",
            "const b = `шаблон ${a}`;",
            "const c = <p>текст</p>;",
        ].join('\n'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
        const kinds: ts.SyntaxKind[] = [];
        const visit = (node: ts.Node) => {
            if (TEXT_TOKENS.has(node.kind) && CYRILLIC.test(node.getText(source))) kinds.push(node.kind);
            ts.forEachChild(node, visit);
        };
        visit(source);
        expect(kinds).toEqual([ts.SyntaxKind.StringLiteral, ts.SyntaxKind.TemplateHead, ts.SyntaxKind.JsxText]);
    });
});
