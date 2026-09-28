/**
 * AppHistory: Atrás/Adelante como app nativa. jsdom implementa pushState,
 * history.back/forward y popstate reales; la vista de la app es un objeto
 * simple y los diálogos son nodos del DOM. La prueba de extremo a extremo en
 * Chromium móvil está en scripts/check-mobile-back-navigation.cjs.
 */
import { createAppHistory } from '../modules/core/AppHistory.js';

const flush = (ms = 20) => new Promise(resolve => setTimeout(resolve, ms));

function setActivation(active) {
    Object.defineProperty(window.navigator, 'userActivation', {
        configurable: true,
        value: active === null ? undefined : { isActive: active, hasBeenActive: true }
    });
}

describe('AppHistory', () => {
    let view;
    let appHistory;
    let hints;
    let standalone;
    let applyResult;

    const make = () => createAppHistory({
        getView: () => ({ ...view }),
        applyView: target => {
            if (applyResult === false) return false;
            view = { tab: target.tab, sub: target.sub };
            return true;
        },
        isStandalone: () => standalone,
        onExitHint: () => hints.push(Date.now())
    });
    const saNav = () => history.state?.saNav;
    const navigate = async (tab, sub = null) => { view = { tab, sub }; appHistory.sync(); await flush(); };
    const back = async () => { history.back(); await flush(60); };
    const forward = async () => { history.forward(); await flush(60); };

    function openDialog({ id = 'dlg', closable = true, escape = false } = {}) {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.id = id;
        const dialog = document.createElement('div');
        dialog.setAttribute('role', 'dialog');
        overlay.appendChild(dialog);
        if (closable) {
            const close = document.createElement('button');
            close.setAttribute('aria-label', 'Cerrar');
            close.addEventListener('click', () => overlay.remove());
            dialog.appendChild(close);
        }
        if (escape) overlay.addEventListener('keydown', event => { if (event.key === 'Escape') overlay.remove(); });
        document.body.appendChild(overlay);
        return overlay;
    }

    beforeEach(async () => {
        document.body.innerHTML = '';
        view = { tab: 'attendance', sub: null };
        hints = [];
        standalone = false;
        applyResult = true;
        setActivation(null);
        history.replaceState(null, '');
        appHistory = make().start();
        await flush();
    });

    afterEach(() => appHistory.stop());

    test('una entrada por cambio de vista; renders repetidos no agregan entradas', async () => {
        const start = history.length;
        await navigate('employees', 'employees');
        for (let i = 0; i < 5; i++) appHistory.sync();
        await flush();
        expect(history.length).toBe(start + 1);
        expect(saNav()).toMatchObject({ kind: 'view', idx: 1, view: { tab: 'employees', sub: 'employees' } });
        await navigate('employees', 'leaders');
        expect(saNav()).toMatchObject({ idx: 2, view: { sub: 'leaders' } });
    });

    test('Atrás y Adelante aplican la vista de cada entrada en orden natural', async () => {
        await navigate('employees', 'employees');
        await navigate('export', 'generator');
        await back();
        expect(view).toEqual({ tab: 'employees', sub: 'employees' });
        await back();
        expect(view).toEqual({ tab: 'attendance', sub: null });
        await forward();
        await forward();
        expect(view).toEqual({ tab: 'export', sub: 'generator' });
        expect(saNav().idx).toBe(2);
    });

    test('sin activación de usuario no se crean entradas: se reemplaza la actual', async () => {
        setActivation(false);
        const start = history.length;
        await navigate('settings', 'general');
        expect(history.length).toBe(start);
        expect(saNav()).toMatchObject({ idx: 0, view: { tab: 'settings' } });
        openDialog();
        appHistory.sync();
        await flush();
        expect(saNav().depth).toBe(0);                 // capa sin entrada propia
    });

    test('Atrás cierra el diálogo superior sin cambiar de vista; Adelante no lo reabre', async () => {
        await navigate('employees', 'employees');
        openDialog();
        appHistory.sync();
        await flush();
        expect(saNav()).toMatchObject({ kind: 'layer', depth: 1 });
        await back();
        expect(document.querySelector('.modal-overlay')).toBeNull();
        expect(view.tab).toBe('employees');
        expect(saNav()).toMatchObject({ kind: 'view', depth: 0 });
        await forward();
        await flush(60);
        expect(document.querySelector('.modal-overlay')).toBeNull();
        expect(saNav()).toMatchObject({ kind: 'view', idx: 1 });
    });

    test('cerrar el diálogo desde la interfaz retira su entrada', async () => {
        await navigate('employees', 'employees');
        const dialog = openDialog();
        appHistory.sync();
        await flush();
        dialog.querySelector('button').click();
        appHistory.sync();
        await flush(80);
        expect(saNav()).toMatchObject({ kind: 'view', idx: 1, depth: 0 });
        await back();
        expect(view.tab).toBe('attendance');
    });

    test('un diálogo que solo responde a Escape también se cierra con Atrás', async () => {
        await navigate('employees', 'employees');
        openDialog({ closable: false, escape: true });
        appHistory.sync();
        await flush();
        await back();
        expect(document.querySelector('.modal-overlay')).toBeNull();
        expect(view.tab).toBe('employees');
    });

    test('un diálogo que no se deja cerrar no atrapa: Atrás sigue navegando', async () => {
        await navigate('employees', 'employees');
        openDialog({ closable: false, escape: false });
        appHistory.sync();
        await flush();
        await back();                                  // intenta cerrar, no puede
        expect(document.querySelector('.modal-overlay')).not.toBeNull();
        await back();
        expect(view.tab).toBe('attendance');
    });

    test('una vista que no se puede dejar (cambios sin guardar) recupera su entrada', async () => {
        await navigate('settings', 'general');
        applyResult = false;
        await back();
        await flush(60);
        expect(view.tab).toBe('settings');
        expect(saNav()).toMatchObject({ idx: 1, view: { tab: 'settings' } });
    });

    test('standalone: la vista inicial avisa en vez de salir y la guardia se rearma con un toque', async () => {
        appHistory.stop();
        standalone = true;
        history.replaceState(null, '');
        appHistory = make().start();
        document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await flush();
        expect(saNav()).toMatchObject({ kind: 'guard', idx: 1 });
        await back();
        expect(saNav().idx).toBe(0);
        expect(hints).toHaveLength(1);
        expect(appHistory.exitHintActive).toBe(true);
        document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await flush();
        expect(saNav()).toMatchObject({ kind: 'guard', idx: 1 });
    });

    test('fuera de standalone no hay guardia', async () => {
        document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await flush();
        expect(saNav()).toMatchObject({ kind: 'view', idx: 0 });
    });

    test('recarga: se conserva la posición y un diálogo no se reabre', async () => {
        await navigate('employees', 'employees');
        openDialog();
        appHistory.sync();
        await flush();
        appHistory.stop();
        document.body.innerHTML = '';
        view = { tab: 'attendance', sub: null };      // la app arranca en su pestaña por defecto
        appHistory = make().start();
        await flush();
        expect(saNav()).toMatchObject({ kind: 'view', idx: 2, depth: 0, view: { tab: 'employees' } });
        expect(view.tab).toBe('employees');
    });

    test('la URL no cambia', async () => {
        const url = location.href;
        await navigate('export', 'history');
        openDialog();
        appHistory.sync();
        await flush();
        expect(location.href).toBe(url);
    });
});
