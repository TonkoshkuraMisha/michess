// --- FILE: frontend/src/components/chessboard/BoardTextureLayer.tsx ---
// Слой процедурной текстуры доски (таск 18.1) поверх цвета рамки или клетки.

import {textureLayerStyle} from '../../config/boardAppearance';
import type {BoardTheme} from '../../config/boardAppearance';

export function BoardTextureLayer({theme, where, isDark = false}: { theme: BoardTheme; where: 'frame' | 'square'; isDark?: boolean }) {
    const style = textureLayerStyle(theme, where, isDark);
    return style ? <div aria-hidden="true" data-testid={`texture-${where}`} className="absolute inset-0 pointer-events-none" style={style}/> : null;
}
