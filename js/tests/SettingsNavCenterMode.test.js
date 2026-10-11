/**
 * Ajustes → General: "Botón central de la barra" (auto | plus | mic).
 * Es una opción auto-save (commitAutoSaveOption): se guarda al tocarla.
 */
import { SettingsGeneralTab } from '../modules/ui/settings/SettingsGeneralTab.js';
import { HolidayService } from '../modules/features/attendance/HolidayService.js';

const draw = (settings) => {
    const state = { settings: { companyName: 'Prueba', holidays: [], payPeriod: {}, ...settings } };
    const context = { state, icons: { get: () => '', getAvailableSets: () => ['unicode'] }, holidayService: new HolidayService(state) };
    document.body.innerHTML = SettingsGeneralTab(context);
};
const options = () => [...document.querySelectorAll('input[name="navCenterMode"]')];

describe('Ajustes → botón central de la barra', () => {
    test('ofrece Automático, Siempre + y Siempre micrófono; por defecto Automático', () => {
        draw({});
        expect(options().map(o => o.value)).toEqual(['auto', 'plus', 'mic']);
        expect(options().find(o => o.checked).value).toBe('auto');
        expect(document.querySelector('input[name="navCenterMode"][value="auto"]').closest('.stg-choice-option').classList.contains('is-selected')).toBe(true);
    });

    test('muestra la opción guardada', () => {
        draw({ navCenterMode: 'mic' });
        expect(options().find(o => o.checked).value).toBe('mic');
    });

    test('explica que el micrófono necesita Voz activa', () => {
        draw({ voiceMvpEnabled: false });
        expect(document.body.textContent).toMatch(/Voz/);
    });
});
