/**
 * Interruptor «Enderezar facturas» (Configuración → Tests), apagado por defecto.
 */
import { SettingsTestsTab } from '../modules/ui/settings/SettingsTestsTab.js';
import { commitAutoSaveSwitch } from '../modules/ui/SettingsUI.js';

const tab = (settings = {}) => { document.body.innerHTML = SettingsTestsTab({ state: { settings } }); };

describe('Configuración → Tests: enderezar facturas', () => {
    afterEach(() => { document.body.innerHTML = ''; });

    test('apagado por defecto y refleja lo guardado', () => {
        tab({});
        expect(document.getElementById('receiptStraighten').checked).toBe(false);
        tab({ receiptStraighten: true });
        expect(document.getElementById('receiptStraighten').checked).toBe(true);
    });
    test('aparece una sola vez, fuera de los grupos plegables, separado del recorte', () => {
        tab({});
        expect(document.querySelectorAll('#receiptStraighten')).toHaveLength(1);
        const input = document.getElementById('receiptStraighten');
        expect(input.closest('details')).toBeNull();
        expect(input.closest('section')).not.toBe(document.getElementById('receiptAutoCrop').closest('section'));
    });
    test('explica lo que hace y que ante la duda no toca la foto', () => {
        tab({});
        const text = document.getElementById('receiptStraighten').closest('section').textContent;
        expect(text).toMatch(/endere/i);
        expect(text).toMatch(/duda/i);
        expect(text).toMatch(/factura larga/i);
    });
    test('se guarda en state.settings y dispara el guardado', () => {
        const st = { settings: {} };
        const calls = { save: 0 };
        const deps = { state: st, batchSetState: (cb) => cb(), save: () => { calls.save++; }, now: () => 99 };
        expect(commitAutoSaveSwitch({ id: 'receiptStraighten', checked: true, deps })).toEqual({ committed: true, key: 'receiptStraighten' });
        expect(st.settings.receiptStraighten).toBe(true);
        expect(calls.save).toBe(1);
    });
    test('el diagnóstico muestra cuántas se enderezaron cuando hay datos', () => {
        localStorage.setItem('sa.pcam.diag.v1', JSON.stringify([
            { t: 1, type: 'shot', origin: 'sensor', saveMs: 900, straightened: { skew: 9.5, persp: 1.1 } }
        ]));
        tab({ newReceiptCamera: true });
        expect(document.querySelector('[data-pcam-diag]').textContent).toMatch(/Enderezadas:\s*1/);
        localStorage.removeItem('sa.pcam.diag.v1');
    });
});
