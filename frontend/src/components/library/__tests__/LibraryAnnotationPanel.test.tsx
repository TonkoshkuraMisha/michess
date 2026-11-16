// Аннотация партии библиотеки (таск 27.4): текст к текущему ходу, переход между комментариями, подпись статуса.

import {fireEvent, render, screen} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';
import {LibraryAnnotationPanel} from '../LibraryAnnotationPanel';
import type {LibraryAnnotation} from '../../../services/library';

const ANNOTATION: LibraryAnnotation = {
    status: 'auto', version: 1, evals: [],
    comments: {
        '3': {comment: [{key: 'coach.verdict.blunder.v1', params: {move: 'Nc6'}}]},
        '6': {comment: [{key: 'coach.verdict.inaccuracy.v1', params: {move: 'Nf6'}}]},
        '9': {comment: [{key: 'coach.no.such.key', params: {}}]},  // незнакомый ключ — не считается
    },
};

describe('аннотация партии библиотеки', () => {
    it('комментарий к ходу, подпись черновика и переход к следующему', () => {
        const onSelect = vi.fn();
        const view = render(<LibraryAnnotationPanel annotation={ANNOTATION} viewIndex={3} onSelect={onSelect}/>);
        expect(screen.getByTestId('library-annotation')).toHaveTextContent('черновик, собран автоматически · комментариев: 2');
        expect(screen.getByTestId('library-annotation-text')).toHaveTextContent('Nc6');
        expect(screen.getByTestId('library-annotation-prev')).toBeDisabled();
        fireEvent.click(screen.getByTestId('library-annotation-next'));
        expect(onSelect).toHaveBeenCalledWith(6);
        view.rerender(<LibraryAnnotationPanel annotation={ANNOTATION} viewIndex={4} onSelect={onSelect}/>);
        expect(screen.getByTestId('library-annotation-text')).toHaveTextContent('комментария нет');
    });

    it('без понятных комментариев панели нет', () => {
        const empty: LibraryAnnotation = {...ANNOTATION, comments: {'9': ANNOTATION.comments['9']}};
        const {container} = render(<LibraryAnnotationPanel annotation={empty} viewIndex={0} onSelect={vi.fn()}/>);
        expect(container).toBeEmptyDOMElement();
    });
});
