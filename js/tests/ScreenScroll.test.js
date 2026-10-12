/**
 * Al cambiar de pantalla se empieza desde arriba; un repintado de la misma
 * pantalla conserva el scroll (RenderManager).
 */
import 'fake-indexeddb/auto';
import { screenKey, createScreenTracker } from '../modules/core/ScreenScroll.js';
import { saveScrollPosition, restoreScrollPosition, resetScrollForNewScreen } from '../modules/core/RenderManager.js';

describe('screenKey', () => {
    test('las vistas internas que son otra pantalla cambian la clave', () => {
        expect(screenKey({ activeTab: 'attendance' })).toBe('attendance:day');
        expect(screenKey({ activeTab: 'attendance', viewMode: 'week' })).toBe('attendance:week');
        expect(screenKey({ activeTab: 'employees', employeeViewMode: 'leaders' })).toBe('employees:leaders');
        expect(screenKey({ activeTab: 'export', payrollViewMode: 'ledger' })).toBe('export:ledger');
        expect(screenKey({ activeTab: 'settings', settingsActiveTab: 'data' })).toBe('settings:data');
        expect(screenKey({ activeTab: 'pettycash', viewMode: 'week' })).toBe('pettycash');
    });
});

describe('createScreenTracker', () => {
    test('el primer render no cuenta como cambio; luego solo cuando la pantalla es otra', () => {
        const tracker = createScreenTracker();
        expect(tracker.changed({ activeTab: 'attendance' })).toBe(false);
        expect(tracker.changed({ activeTab: 'attendance', loading: true })).toBe(false);
        expect(tracker.changed({ activeTab: 'export' })).toBe(true);
        expect(tracker.changed({ activeTab: 'export' })).toBe(false);
        expect(tracker.changed({ activeTab: 'export', payrollViewMode: 'history' })).toBe(true);
    });
});

describe('resetScrollForNewScreen', () => {
    let frames, y, scrollTo;
    beforeEach(() => {
        frames = []; y = 0;
        window.requestAnimationFrame = jest.fn(cb => { frames.push(cb); return frames.length; });
        scrollTo = jest.fn((a, b) => { y = typeof a === 'object' ? (a.top ?? y) : (b ?? y); });
        window.scrollTo = scrollTo;
        Object.defineProperty(window, 'scrollY', { get: () => y, configurable: true });
    });

    test('misma pantalla: un repintado que recorta el scroll lo restaura (sin cambios)', () => {
        y = 800; saveScrollPosition(); y = 300; restoreScrollPosition();
        frames.forEach(cb => cb());
        expect(scrollTo).toHaveBeenLastCalledWith(0, 800);
    });

    test('otra pantalla: sube al inicio y no vuelve a la altura anterior', () => {
        y = 800; saveScrollPosition();
        restoreScrollPosition(); // restauración pendiente de un render anterior
        resetScrollForNewScreen();
        frames.forEach(cb => cb());
        expect(scrollTo).toHaveBeenCalledWith(0, 0);
        expect(scrollTo).not.toHaveBeenCalledWith(0, 800);
        expect(y).toBe(0);
    });
});
