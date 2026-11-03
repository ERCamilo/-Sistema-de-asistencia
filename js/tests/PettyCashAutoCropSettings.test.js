/**
 * Interruptor «Recortar la factura automáticamente» (Configuración → Tests), apagado por defecto.
 */
import { SettingsTestsTab } from '../modules/ui/settings/SettingsTestsTab.js';
import { commitAutoSaveSwitch } from '../modules/ui/SettingsUI.js';

const tab = (settings = {}) => { document.body.innerHTML = SettingsTestsTab({ state: { settings } }); };

describe('Configuración → Tests: recorte automático', () => {
    afterEach(() => { document.body.innerHTML = ''; });

    test('apagado por defecto y refleja lo guardado', () => {
        tab({});
        expect(document.getElementById('receiptAutoCrop').checked).toBe(false);
        tab({ receiptAutoCrop: true });
        expect(document.getElementById('receiptAutoCrop').checked).toBe(true);
    });
    test('aparece una sola vez, fuera de los grupos plegables, y explica que no endereza', () => {
        tab({});
        expect(document.querySelectorAll('#receiptAutoCrop')).toHaveLength(1);
        expect(document.getElementById('receiptAutoCrop').closest('details')).toBeNull();
        expect(document.getElementById('receiptAutoCrop').closest('section').textContent).toMatch(/no endereza/i);
    });
    test('se guarda en state.settings y dispara el guardado', () => {
        const st = { settings: {} };
        const calls = { save: 0 };
        const deps = { state: st, batchSetState: (cb) => cb(), save: () => { calls.save++; }, now: () => 99 };
        expect(commitAutoSaveSwitch({ id: 'receiptAutoCrop', checked: true, deps })).toEqual({ committed: true, key: 'receiptAutoCrop' });
        expect(st.settings.receiptAutoCrop).toBe(true);
        expect(calls.save).toBe(1);
    });
});
