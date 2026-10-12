/**
 * Botón "Ir arriba": oculto por defecto, solo aparece con el ajuste
 * `scrollTopButton` activo y la pantalla desplazada más de 400px.
 */
import { shouldShowBackToTop, syncBackToTop } from '../modules/ui/BackToTop.js';

const buildButton = () => {
    document.body.innerHTML = '<div id="backToTop" class="back-to-top"></div>';
    return document.getElementById('backToTop');
};

describe('shouldShowBackToTop', () => {
    test('por defecto (ajuste ausente) nunca se muestra, aunque haya scroll', () => {
        expect(shouldShowBackToTop({ scrollY: 5000 })).toBe(false);
        expect(shouldShowBackToTop({ enabled: undefined, scrollY: 5000 })).toBe(false);
        expect(shouldShowBackToTop({ enabled: false, scrollY: 5000 })).toBe(false);
    });
    test('solo enabled === true cuenta', () => {
        expect(shouldShowBackToTop({ enabled: 'true', scrollY: 5000 })).toBe(false);
    });
    test('activo y scrollY > 400 se muestra', () => {
        expect(shouldShowBackToTop({ enabled: true, scrollY: 401 })).toBe(true);
    });
    test('activo y scrollY <= 400 no se muestra', () => {
        expect(shouldShowBackToTop({ enabled: true, scrollY: 400 })).toBe(false);
        expect(shouldShowBackToTop({ enabled: true, scrollY: 0 })).toBe(false);
    });
});

describe('syncBackToTop', () => {
    test('desactivado: queda oculto (hidden + aria-hidden) sin clase visible', () => {
        const btn = buildButton();
        syncBackToTop(document, { enabled: false, scrollY: 900 });
        expect(btn.classList.contains('visible')).toBe(false);
        expect(btn.hidden).toBe(true);
        expect(btn.getAttribute('aria-hidden')).toBe('true');
    });
    test('activo con scroll: visible y accesible', () => {
        const btn = buildButton();
        syncBackToTop(document, { enabled: true, scrollY: 900 });
        expect(btn.classList.contains('visible')).toBe(true);
        expect(btn.hidden).toBe(false);
        expect(btn.getAttribute('aria-hidden')).toBe('false');
    });
    test('activo sin scroll: presente pero sin clase visible', () => {
        const btn = buildButton();
        syncBackToTop(document, { enabled: true, scrollY: 100 });
        expect(btn.classList.contains('visible')).toBe(false);
        expect(btn.hidden).toBe(false);
    });
    test('desactivar estando visible lo oculta de inmediato', () => {
        const btn = buildButton();
        syncBackToTop(document, { enabled: true, scrollY: 900 });
        expect(btn.classList.contains('visible')).toBe(true);
        syncBackToTop(document, { enabled: false, scrollY: 900 });
        expect(btn.classList.contains('visible')).toBe(false);
        expect(btn.hidden).toBe(true);
    });
    test('sin botón en el DOM no revienta', () => {
        document.body.innerHTML = '';
        expect(() => syncBackToTop(document, { enabled: true, scrollY: 900 })).not.toThrow();
    });
});

describe('Configuración → General: interruptor scrollTopButton', () => {
    const { initSettingsUI, SettingsTab } = require('../modules/ui/SettingsUI.js');
    const render = (settings = {}) => {
        initSettingsUI({
            state: { settingsActiveTab: 'general', settings: { companyName: 'Empresa', holidays: [], ...settings }, employees: [], positions: [], attendance: {}, swVersion: '1' },
            icons: { get: (name) => `[icon:${name}]`, getAvailableSets: () => ['default'] },
            holidayService: { renderSettingsCalendar: () => '' },
            get currentUser() { return null; },
            get autoSyncEnabled() { return true; },
            calculateStorageStats: () => ({ percentage: 0, usedMB: 0, available: '5MB' })
        });
        document.body.innerHTML = SettingsTab();
        return document.getElementById('scrollTopButton');
    };
    test('desmarcado por defecto', () => {
        expect(render().checked).toBe(false);
    });
    test('marcado cuando scrollTopButton === true', () => {
        expect(render({ scrollTopButton: true }).checked).toBe(true);
    });
});
