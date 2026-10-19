import { SettingsTestsTab } from '../modules/ui/settings/SettingsTestsTab.js';
import { commitAutoSaveSwitch } from '../modules/ui/SettingsUI.js';

const tab = (settings = {}) => { document.body.innerHTML = SettingsTestsTab({ state: { settings } }); };

describe('Configuración → Tests: pantalla nueva de Caja chica', () => {
    afterEach(() => { document.body.innerHTML = ''; });

    test('el interruptor de la pantalla nueva está apagado por defecto y refleja lo guardado', () => {
        tab({});
        expect(document.getElementById('newPettyCashScreen').checked).toBe(false);
        tab({ newPettyCashScreen: true });
        expect(document.getElementById('newPettyCashScreen').checked).toBe(true);
    });

    test('la seguridad de la lectura está oculta (apagada) por defecto y refleja lo guardado', () => {
        tab({});
        expect(document.getElementById('pettyCashReadConfidence').checked).toBe(false);
        tab({ pettyCashReadConfidence: true });
        expect(document.getElementById('pettyCashReadConfidence').checked).toBe(true);
    });

    test('cada interruptor aparece una sola vez, fuera de los grupos plegables', () => {
        tab({});
        for (const id of ['newPettyCashScreen', 'pettyCashReadConfidence']) {
            expect(document.querySelectorAll(`#${id}`)).toHaveLength(1);
            expect(document.getElementById(id).closest('details')).toBeNull();
        }
    });
});

describe('Configuración: auto-guardado de los interruptores de Caja chica', () => {
    const harness = () => {
        const st = { settings: {} };
        const calls = { save: 0 };
        return { st, calls, deps: { state: st, batchSetState: (cb) => cb(), save: () => { calls.save++; }, now: () => 1234 } };
    };

    test.each(['newPettyCashScreen', 'pettyCashReadConfidence'])('%s se guarda en state.settings y dispara el guardado', (id) => {
        const { st, calls, deps } = harness();
        expect(commitAutoSaveSwitch({ id, checked: true, deps })).toEqual({ committed: true, key: id });
        expect(st.settings[id]).toBe(true);
        expect(st.settings.updatedAt).toBe(1234);
        expect(st.settings._isDirty).toBe(true);
        expect(calls.save).toBe(1);
        commitAutoSaveSwitch({ id, checked: false, deps });
        expect(st.settings[id]).toBe(false);
    });
});
