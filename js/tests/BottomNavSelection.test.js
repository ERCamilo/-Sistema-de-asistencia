/**
 * La barra de 6 pestañas sigue siendo la predeterminada. La barra de 5
 * posiciones (BottomNav) se prueba desde Configuración → Tests con el
 * interruptor `newBottomNav`; junto a él vive la opción del botón central.
 */
import { chooseBottomNav, renderLegacyBottomNav } from '../modules/ui/navigation/LegacyBottomNav.js';
import { _resetBottomNavState } from '../modules/ui/navigation/BottomNav.js';
import { SettingsTestsTab } from '../modules/ui/settings/SettingsTestsTab.js';

const icons = { get: (name) => `<i data-icon="${name}"></i>` };
const env = { voiceAvailable: false, online: true, micDenied: false };

describe('selección de barra inferior', () => {
    beforeEach(() => _resetBottomNavState());

    test('por defecto se muestra la barra de siempre (6 pestañas)', () => {
        document.body.innerHTML = chooseBottomNav({ activeTab: 'attendance', settings: {} }, { icons, ...env });
        expect(document.querySelector('.bnav')).toBeNull();
        const tabs = [...document.querySelectorAll('.bottom-nav-tab')];
        expect(tabs.map(t => t.textContent.trim())).toEqual(['Asistencia', 'Personal', 'Reportes', 'Nómina', 'Caja', 'Ajustes']);
        expect(tabs[0].classList.contains('active')).toBe(true);
        expect(tabs.map(t => t.dataset.appFn)).toEqual(['changeTab', 'openEmpleadosPersonal', 'changeTab', 'openNomina', 'changeTab', 'openAjustesGenerales']);
    });

    test('con newBottomNav activado se muestra la barra de 5 posiciones', () => {
        document.body.innerHTML = chooseBottomNav({ activeTab: 'attendance', settings: { newBottomNav: true } }, { icons, ...env });
        expect(document.querySelector('.bnav')).not.toBeNull();
        expect(document.querySelectorAll('[data-bnav-section]')).toHaveLength(4);
        expect(document.querySelector('[data-bnav-center]')).not.toBeNull();
    });

    test('la barra de siempre marca la pestaña activa como antes', () => {
        const active = (state) => {
            document.body.innerHTML = renderLegacyBottomNav(state, icons);
            return [...document.querySelectorAll('.bottom-nav-tab.active')].map(t => t.textContent.trim());
        };
        expect(active({ activeTab: 'positions' })).toEqual(['Personal']);
        expect(active({ activeTab: 'dashboard' })).toEqual(['Reportes']);
        expect(active({ activeTab: 'export' })).toEqual(['Nómina']);
        expect(active({ activeTab: 'pettycash' })).toEqual(['Caja']);
        expect(active({ activeTab: 'settings' })).toEqual(['Ajustes']);
    });
});

describe('Configuración → Tests: prueba de la barra nueva', () => {
    const draw = (settings) => { document.body.innerHTML = SettingsTestsTab({ state: { settings } }); };

    test('interruptor apagado por defecto; la opción del botón central se ve solo al activarlo', () => {
        draw({});
        expect(document.getElementById('newBottomNav').checked).toBe(false);
        expect(document.querySelector('input[name="navCenterMode"]')).toBeNull();

        draw({ newBottomNav: true, navCenterMode: 'plus' });
        expect(document.getElementById('newBottomNav').checked).toBe(true);
        const options = [...document.querySelectorAll('input[name="navCenterMode"]')];
        expect(options.map(o => o.value)).toEqual(['auto', 'plus', 'mic']);
        expect(options.find(o => o.checked).value).toBe('plus');
    });
});
