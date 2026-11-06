/**
 * Los botones del editor de factura (Reescanear, Enderezar, Ver comprobante, Marcar…) deben
 * verse como botones: con borde y fondo propios y con estados (pasar el dedo/ratón, apretar,
 * foco de teclado, desactivado). Antes eran texto sin borde ni fondo y no parecían acciones.
 * Es una prueba sobre la hoja de estilos: jsdom no calcula estilos de clases externas.
 */
import fs from 'fs';
import path from 'path';

const css = fs.readFileSync(path.join(__dirname, '../../css/pettycash-screen.css'), 'utf8');
/** Declaraciones de la primera regla que empieza exactamente con `selector {`. */
const rule = (selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`));
    return match ? match[1] : null;
};
const has = (decls, prop) => new RegExp(`(?:^|;|\\s)${prop}\\s*:`).test(decls || '');
const value = (decls, prop) => (decls || '').match(new RegExp(`(?:^|;|\\s)${prop}\\s*:\\s*([^;]+)`))?.[1]?.trim();

describe('botones de acción del editor (.pcn-tool)', () => {
    const tool = rule('.pcn-tool');
    test('tienen borde visible y un fondo propio (no son texto suelto)', () => {
        expect(tool).not.toBeNull();
        expect(value(tool, 'border')).toBeDefined();
        expect(value(tool, 'border')).not.toMatch(/^(0|none)\b/);
        expect(value(tool, 'background')).toBeDefined();
        expect(value(tool, 'background')).not.toMatch(/^(transparent|none)\b/);
    });
    test('el texto tiene buen contraste con el fondo (no el gris tenue de las notas)', () => {
        expect(value(tool, 'color')).toBe('var(--pcn-text)');
    });
    test('son tocables con el dedo (40 px o más, para que quepan en dos filas) y no se achican en la fila', () => {
        expect(parseInt(value(tool, 'min-height'), 10)).toBeGreaterThanOrEqual(40);
        expect(rule('.pcn-tools > *')).toMatch(/flex:\s*0 0 auto/);
    });
    test('responden: pasar el ratón, apretar, foco de teclado y desactivado', () => {
        expect(rule('.pcn-tool:hover')).not.toBeNull();
        expect(rule('.pcn-tool:active')).not.toBeNull();
        expect(rule('.pcn-tool:focus-visible')).not.toBeNull();
        expect(rule('.pcn-tool[disabled]')).toMatch(/opacity/);
    });
    test('la fila de botones deja aire entre ellos', () => {
        expect(has(rule('.pcn-tools'), 'gap')).toBe(true);
    });
    test('todos se ven a la vez: la fila pasa a otra línea en vez de esconder botones a la derecha', () => {
        expect(value(rule('.pcn-tools'), 'flex-wrap')).toBe('wrap');
        expect(value(rule('.pcn-tools'), 'overflow-x')).toBeUndefined();
    });
    test('siguen las mismas variables del editor (mismo diseño, no colores nuevos sueltos)', () => {
        expect(tool).toMatch(/var\(--pcn-line\)/);
        expect(tool).toMatch(/var\(--pcn-panel\)/);
    });
});

describe('otros botones que ya se veían como botones no cambian', () => {
    test('el pie (.pcn-btn), los avisos (.pcn-fix) y las pastillas (.pcn-chip) siguen con borde', () => {
        for (const selector of ['.pcn-btn', '.pcn-fix', '.pcn-chip']) {
            expect(value(rule(selector), 'border')).toMatch(/1px solid/);
        }
    });
});
