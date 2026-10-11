/**
 * La opción "Botón central de la barra" (navCenterMode) pertenece a la
 * prueba de la barra nueva: vive en Configuración → Tests junto a su
 * interruptor (ver BottomNavSelection.test.js), no en General.
 */
import { SettingsGeneralTab } from '../modules/ui/settings/SettingsGeneralTab.js';
import { HolidayService } from '../modules/features/attendance/HolidayService.js';

test('Ajustes → General no muestra la opción del botón central', () => {
    const state = { settings: { companyName: 'Prueba', holidays: [], payPeriod: {}, newBottomNav: true } };
    const context = { state, icons: { get: () => '', getAvailableSets: () => ['unicode'] }, holidayService: new HolidayService(state) };
    document.body.innerHTML = SettingsGeneralTab(context);
    expect(document.querySelector('input[name="navCenterMode"]')).toBeNull();
});
