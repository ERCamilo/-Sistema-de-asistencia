import fs from 'fs';
import path from 'path';

/**
 * Bottom navigation labels must never spill into the neighbouring tab.
 *
 * At 381–400 px (e.g. iPhone 12–15, 390 px) each of the six tabs is ~61 px
 * wide while "ASISTENCIA" rendered at 0.65rem + 0.5px tracking measured
 * 68 px: flex items default to `min-width: auto`, so the label overflowed and
 * read as "ASISTENCIAPERSONAL". Layout cannot be measured in jsdom, so this
 * pins the CSS contract that keeps every label inside its own tab.
 */
const css = fs.readFileSync(path.resolve(__dirname, '../../css/navigation.css'), 'utf8');

function ruleBody(selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`));
    if (!match) throw new Error(`No se encontró la regla ${selector} en navigation.css`);
    return match[1];
}

const declarations = (selector) => Object.fromEntries(
    ruleBody(selector)
        .split(';')
        .map((d) => d.replace(/\/\*[\s\S]*?\*\//g, '').trim())
        .filter(Boolean)
        .map((d) => {
            const i = d.indexOf(':');
            return [d.slice(0, i).trim(), d.slice(i + 1).trim()];
        })
);

describe('Barra de navegación inferior — las etiquetas caben en su pestaña', () => {
    test('las pestañas pueden encogerse por debajo del ancho de su texto', () => {
        const tab = declarations('.bottom-nav-tab');
        expect(tab.flex).toBe('1');
        expect(tab['min-width']).toBe('0');
    });

    test('la etiqueta queda recortada dentro de la pestaña en vez de invadir la vecina', () => {
        const text = declarations('.bottom-nav-text');
        expect(text['max-width']).toBe('100%');
        expect(text.overflow).toBe('hidden');
        expect(text['text-overflow']).toBe('ellipsis');
        expect(text['white-space']).toBe('nowrap');
    });

    test('el tamaño de la etiqueta se adapta al ancho y conserva el estilo en pantallas amplias', () => {
        const text = declarations('.bottom-nav-text');
        expect(text['font-size']).toMatch(/^clamp\(\s*0\.5\d?rem\s*,\s*[\d.]+vw\s*,\s*0\.65rem\s*\)$/);
        expect(text['text-transform']).toBe('uppercase');
        expect(text['font-weight']).toBe('600');
    });
});
