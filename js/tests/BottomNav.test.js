/**
 * Barra inferior de 5 posiciones: secciones con menú, botón central de
 * captura (micrófono / "+") y memoria de la última pantalla por sección.
 */
import {
    NAV_SECTIONS, activeNavItem, sectionOfItem, resolveCenterMode, navigateToItem,
    renderBottomNav, initBottomNav, lastNavItem, rememberNavItem, bottomNavOpenMenu,
    _resetBottomNavState, HOLD_TO_TALK_MS, watchMicPermission
} from '../modules/ui/navigation/BottomNav.js';

function makeWin(overrides = {}) {
    const store = new Map();
    const calls = [];
    const fn = name => (...args) => calls.push([name, ...args]);
    const win = {
        localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) },
        requestAnimationFrame: cb => setTimeout(cb, 0),
        setTimeout: (cb, ms) => setTimeout(cb, ms),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        ...Object.fromEntries(['changeTab', 'changeViewMode', 'openEmpleadosPersonal', 'openPuestosPersonal', 'openLideresPersonal',
            'openNomina', 'openCuentasPorCobrar', 'openHistorialNomina', 'openCalendarioAjustes', 'openAjustesGenerales',
            'openDatosAjustes', 'pcCameraBatchPhoto'].map(n => [n, fn(n)])),
        ...overrides
    };
    return { win, calls, store };
}

const pointer = (type, target, extra = {}) => {
    const ev = new Event(type, { bubbles: true, cancelable: true });
    Object.assign(ev, { button: 0, pointerId: 1, ...extra });
    target.dispatchEvent(ev);
    return ev;
};

describe('BottomNav — estructura', () => {
    beforeEach(() => _resetBottomNavState());

    test('cinco posiciones: 4 secciones y el botón central en medio', () => {
        expect(NAV_SECTIONS.map(s => [s.id, s.slot])).toEqual([['asistencia', 0], ['personal', 1], ['finanzas', 3], ['mas', 4]]);
        document.body.innerHTML = renderBottomNav({ activeTab: 'attendance' }, { win: makeWin().win });
        const nav = document.querySelector('[data-bnav]');
        const slots = [...nav.children].filter(el => el.matches('.bnav-tab, .bnav-center-slot'));
        expect(slots.map(el => el.dataset.bnavSection || 'centro')).toEqual(['asistencia', 'personal', 'centro', 'finanzas', 'mas']);
        expect(nav.querySelectorAll('.bottom-nav-text')).toHaveLength(4);
    });

    test('menús de cada sección con sus pantallas', () => {
        const items = Object.fromEntries(NAV_SECTIONS.map(s => [s.id, s.items.map(i => i.label)]));
        expect(items).toEqual({
            asistencia: ['Diaria', 'Semanal'],
            personal: ['Empleados', 'Posiciones', 'Líderes'],
            finanzas: ['Nómina', 'Préstamos', 'Caja chica', 'Historial'],
            mas: ['Reportes', 'Calendario', 'Ajustes', 'Datos']
        });
    });

    test.each([
        [{ activeTab: 'attendance' }, 'attendance-day'],
        [{ activeTab: 'attendance', viewMode: 'week' }, 'attendance-week'],
        [{ activeTab: 'employees' }, 'employees'],
        [{ activeTab: 'employees', employeeViewMode: 'leaders' }, 'leaders'],
        [{ activeTab: 'positions' }, 'positions'],
        [{ activeTab: 'export' }, 'payroll'],
        [{ activeTab: 'export', payrollViewMode: 'ledger' }, 'loans'],
        [{ activeTab: 'export', payrollViewMode: 'history' }, 'history'],
        [{ activeTab: 'pettycash' }, 'pettycash'],
        [{ activeTab: 'employee-report' }, 'reports'],
        [{ activeTab: 'dashboard' }, 'reports'],
        [{ activeTab: 'settings', settingsActiveTab: 'calendar' }, 'calendar'],
        [{ activeTab: 'settings', settingsActiveTab: 'data' }, 'data'],
        [{ activeTab: 'settings', settingsActiveTab: 'tests' }, 'settings'],
        [{ activeTab: 'algo-nuevo' }, null]
    ])('pantalla activa %j → %s', (state, item) => {
        expect(activeNavItem(state)).toBe(item);
    });

    test('marca la sección activa y la pantalla actual dentro de su menú', () => {
        document.body.innerHTML = renderBottomNav({ activeTab: 'export', payrollViewMode: 'ledger' }, { win: makeWin().win });
        const fin = document.querySelector('[data-bnav-section="finanzas"]');
        expect(fin.classList.contains('active')).toBe(true);
        expect(fin.getAttribute('aria-current')).toBe('page');
        expect(document.querySelectorAll('.bnav-tab.active')).toHaveLength(1);
        const current = document.querySelector('[data-bnav-menu="finanzas"] [aria-checked="true"]');
        expect(current.dataset.bnavItem).toBe('loans');
    });
});

describe('BottomNav — botón central', () => {
    test.each([
        [{ voiceAvailable: false, setting: 'mic' }, 'plus'],
        [{ voiceAvailable: true, setting: 'auto', online: true }, 'mic'],
        [{ voiceAvailable: true, setting: 'auto', online: false }, 'plus'],
        [{ voiceAvailable: true, setting: 'auto', online: true, micDenied: true }, 'plus'],
        [{ voiceAvailable: true, setting: 'plus', online: true }, 'plus'],
        [{ voiceAvailable: true, setting: 'mic', online: false }, 'mic']
    ])('%j → %s', (input, mode) => {
        expect(resolveCenterMode(input)).toBe(mode);
    });

    test('el ajuste navCenterMode llega al botón; Dictar solo si Voz está disponible', () => {
        _resetBottomNavState();
        const { win } = makeWin();
        document.body.innerHTML = renderBottomNav({ activeTab: 'attendance', settings: { navCenterMode: 'plus' } }, { voiceAvailable: true, win });
        expect(document.querySelector('[data-bnav-center]').dataset.mode).toBe('plus');
        expect(document.querySelector('[data-bnav-capture="dictate"]')).not.toBeNull();
        document.body.innerHTML = renderBottomNav({ activeTab: 'attendance' }, { voiceAvailable: false, win });
        expect(document.querySelector('[data-bnav-capture="dictate"]')).toBeNull();
        expect(document.querySelectorAll('[data-bnav-capture]')).toHaveLength(2);
    });
});

describe('BottomNav — navegación', () => {
    beforeEach(() => _resetBottomNavState());

    test.each([
        ['employees', 'openEmpleadosPersonal'], ['positions', 'openPuestosPersonal'], ['leaders', 'openLideresPersonal'],
        ['payroll', 'openNomina'], ['loans', 'openCuentasPorCobrar'], ['history', 'openHistorialNomina'],
        ['calendar', 'openCalendarioAjustes'], ['settings', 'openAjustesGenerales'], ['data', 'openDatosAjustes']
    ])('%s usa el atajo %s', (item, fnName) => {
        const { win, calls } = makeWin();
        expect(navigateToItem(item, { win, state: {} })).toBe(true);
        expect(calls).toEqual([[fnName]]);
    });

    test('caja chica y reportes cambian de pestaña', () => {
        const { win, calls } = makeWin();
        navigateToItem('pettycash', { win });
        navigateToItem('reports', { win });
        expect(calls).toEqual([['changeTab', 'pettycash'], ['changeTab', 'employee-report']]);
    });

    test('asistencia semanal: cambia de pestaña y de vista solo si hace falta', () => {
        const a = makeWin();
        navigateToItem('attendance-week', { win: a.win, state: { activeTab: 'export', viewMode: 'day' } });
        expect(a.calls).toEqual([['changeTab', 'attendance'], ['changeViewMode', 'week']]);
        const b = makeWin();
        navigateToItem('attendance-day', { win: b.win, state: { activeTab: 'attendance', viewMode: 'day' } });
        expect(b.calls).toEqual([]);
    });

    test('recuerda la última pantalla de cada sección (y tolera datos guardados inválidos)', () => {
        const { win, store } = makeWin();
        expect(lastNavItem('finanzas', { win })).toBe('payroll');
        rememberNavItem('pettycash', { win });
        expect(lastNavItem('finanzas', { win })).toBe('pettycash');
        expect(JSON.parse(store.get('sa.bottomNav.lastItem')).finanzas).toBe('pettycash');

        _resetBottomNavState();
        store.set('sa.bottomNav.lastItem', '{"finanzas":"no-existe","mas":"data"}');
        expect(lastNavItem('finanzas', { win })).toBe('payroll');
        expect(lastNavItem('mas', { win })).toBe('data');

        _resetBottomNavState();
        store.set('sa.bottomNav.lastItem', '{roto');
        expect(lastNavItem('mas', { win })).toBe('reports');
    });

    test('sin localStorage disponible sigue funcionando', () => {
        const { win } = makeWin();
        Object.defineProperty(win, 'localStorage', { get() { throw new Error('bloqueado'); } });
        rememberNavItem('leaders', { win });
        expect(lastNavItem('personal', { win })).toBe('leaders');
    });
});

describe('BottomNav — interacción', () => {
    let nav; let env; let state;

    const mount = ({ voiceAvailable = true, canCapture = true, setting, inAppCamera = null } = {}) => {
        _resetBottomNavState();
        state = { activeTab: 'attendance', viewMode: 'day', settings: setting ? { navCenterMode: setting } : {} };
        env = makeWin();
        const voice = {
            isAvailable: () => voiceAvailable,
            startHold: jest.fn(() => Promise.resolve()),
            endHold: jest.fn(),
            cancelHold: jest.fn()
        };
        const notify = jest.fn();
        const draw = () => { document.body.innerHTML = renderBottomNav(state, { voiceAvailable, win: env.win }); };
        draw();
        nav = initBottomNav({ doc: document, win: env.win, getState: () => state, voice, pettyCash: { canCapture: () => canCapture, ...(inAppCamera || {}) }, notify, refresh: draw });
        return { voice, notify, draw };
    };
    const $ = sel => document.querySelector(sel);
    const isOpen = id => $(`[data-bnav-menu="${id}"]`).dataset.open === 'true';

    afterEach(() => { nav?.destroy(); jest.useRealTimers(); document.body.innerHTML = ''; });

    test('tocar la sección activa abre y cierra su menú sin navegar', () => {
        mount();
        $('[data-bnav-section="asistencia"]').click();
        expect(isOpen('asistencia')).toBe(true);
        expect($('[data-bnav-section="asistencia"]').getAttribute('aria-expanded')).toBe('true');
        $('[data-bnav-section="asistencia"]').click();
        expect(isOpen('asistencia')).toBe(false);
        expect(env.calls).toEqual([]);
    });

    test('tocar otra sección va a su última pantalla y muestra su menú', () => {
        mount();
        rememberNavItem('pettycash', { win: env.win });
        $('[data-bnav-section="finanzas"]').click();
        expect(env.calls).toEqual([['changeTab', 'pettycash']]);
        expect(isOpen('finanzas')).toBe(true);
        expect(isOpen('asistencia')).toBe(false);
    });

    test('elegir una pantalla navega, la recuerda y cierra el menú', () => {
        mount();
        $('[data-bnav-section="asistencia"]').click();
        $('[data-bnav-item="attendance-week"]').click();
        expect(env.calls).toEqual([['changeViewMode', 'week']]);
        expect(isOpen('asistencia')).toBe(false);
        expect(lastNavItem('asistencia', { win: env.win })).toBe('attendance-week');
    });

    test('un render() con el menú abierto lo conserva abierto', () => {
        const { draw } = mount();
        $('[data-bnav-section="asistencia"]').click();
        draw();
        expect(isOpen('asistencia')).toBe(true);
        expect(bottomNavOpenMenu()).toBe('asistencia');
    });

    test('tocar fuera o Escape cierran el menú', () => {
        mount();
        const outside = document.createElement('div');
        document.body.appendChild(outside);
        $('[data-bnav-section="asistencia"]').click();
        pointer('pointerdown', outside);
        expect(isOpen('asistencia')).toBe(false);

        $('[data-bnav-section="asistencia"]').click();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        expect(isOpen('asistencia')).toBe(false);
    });

    test('micrófono: un toque corto abre el menú de captura', () => {
        jest.useFakeTimers();
        const { voice } = mount();
        const center = $('[data-bnav-center]');
        expect(center.dataset.mode).toBe('mic');
        pointer('pointerdown', center);
        jest.advanceTimersByTime(HOLD_TO_TALK_MS - 50);
        pointer('pointerup', center);
        expect(isOpen('center')).toBe(true);
        expect(voice.startHold).not.toHaveBeenCalled();
    });

    test('micrófono: mantener pulsado dicta y soltar termina', () => {
        jest.useFakeTimers();
        const { voice } = mount();
        const center = $('[data-bnav-center]');
        pointer('pointerdown', center);
        jest.advanceTimersByTime(HOLD_TO_TALK_MS + 10);
        expect(voice.startHold).toHaveBeenCalledTimes(1);
        expect(center.classList.contains('is-listening')).toBe(true);
        expect(center.getAttribute('aria-pressed')).toBe('true');
        pointer('pointerup', center);
        expect(voice.endHold).toHaveBeenCalledTimes(1);
        expect(center.classList.contains('is-listening')).toBe(false);
        expect(isOpen('center')).toBe(false);
    });

    test('mantener pulsado no selecciona ni arrastra otras partes de la barra', () => {
        jest.useFakeTimers();
        mount();
        const center = $('[data-bnav-center]');
        const label = document.querySelector('.bottom-nav-text');
        expect(pointer('touchstart', center).defaultPrevented).toBe(true);
        expect(pointer('touchstart', label).defaultPrevented).toBe(false);
        pointer('pointerdown', center);
        expect(document.documentElement.classList.contains('is-holding')).toBe(true);
        expect(pointer('selectstart', label).defaultPrevented).toBe(true);
        expect(pointer('dragstart', label).defaultPrevented).toBe(true);
        jest.advanceTimersByTime(HOLD_TO_TALK_MS + 10);
        pointer('pointerup', center);
        expect(document.documentElement.classList.contains('is-holding')).toBe(false);
        expect(pointer('selectstart', label).defaultPrevented).toBe(false);
    });

    test('al cancelarse el gesto también se libera la página', () => {
        mount();
        const center = $('[data-bnav-center]');
        pointer('pointerdown', center);
        pointer('pointercancel', center);
        expect(document.documentElement.classList.contains('is-holding')).toBe(false);
    });

    test('si el gesto se cancela (scroll del sistema) la grabación se descarta', () => {
        jest.useFakeTimers();
        const { voice } = mount();
        const center = $('[data-bnav-center]');
        pointer('pointerdown', center);
        jest.advanceTimersByTime(HOLD_TO_TALK_MS + 10);
        pointer('pointercancel', center);
        expect(voice.cancelHold).toHaveBeenCalledTimes(1);
        expect(voice.endHold).not.toHaveBeenCalled();
    });

    test('si Voz no pudo empezar, se apaga el estado de escucha y soltar no abre el menú', async () => {
        jest.useFakeTimers();
        const { voice } = mount();
        voice.startHold.mockResolvedValue(false);
        const center = $('[data-bnav-center]');
        pointer('pointerdown', center);
        jest.advanceTimersByTime(HOLD_TO_TALK_MS + 10);
        await Promise.resolve(); await Promise.resolve();
        expect(center.classList.contains('is-listening')).toBe(false);
        pointer('pointerup', center);
        expect(isOpen('center')).toBe(false);
        expect(voice.endHold).not.toHaveBeenCalled();
    });

    test('sigue el estado real de Voz: escuchando → ✓ guardado → normal', () => {
        mount();
        const center = $('[data-bnav-center]');
        const send = state => window.dispatchEvent(new CustomEvent('sa:voice-state', { detail: { state } }));
        send('listening');
        expect(center.classList.contains('is-listening')).toBe(true);
        send('saved');
        expect(center.classList.contains('is-listening')).toBe(false);
        expect(center.classList.contains('is-saved')).toBe(true);
        expect(center.querySelector('.bnav-center-icon--check')).not.toBeNull();
        send('idle');
        expect(center.classList.contains('is-saved')).toBe(false);
        expect(center.getAttribute('aria-pressed')).toBe('false');
    });

    test('modo "+": mantener pulsado no graba; tocar abre el menú', () => {
        jest.useFakeTimers();
        const { voice } = mount({ setting: 'plus' });
        const center = $('[data-bnav-center]');
        expect(center.dataset.mode).toBe('plus');
        pointer('pointerdown', center);
        jest.advanceTimersByTime(HOLD_TO_TALK_MS * 3);
        pointer('pointerup', center);
        expect(voice.startHold).not.toHaveBeenCalled();
        expect(isOpen('center')).toBe(true);
    });

    test('Dictar desde el menú graba hasta tocar el botón central', () => {
        const { voice, notify } = mount({ setting: 'plus' });
        const center = $('[data-bnav-center]');
        pointer('pointerdown', center); pointer('pointerup', center);
        $('[data-bnav-capture="dictate"]').click();
        expect(voice.startHold).toHaveBeenCalledTimes(1);
        expect(voice.startHold).toHaveBeenCalledWith({ toggle: true });
        expect(notify).toHaveBeenCalledWith(expect.stringContaining('botón central'), 'info');
        expect(isOpen('center')).toBe(false);
        pointer('pointerdown', center); pointer('pointerup', center);
        expect(voice.endHold).toHaveBeenCalledTimes(1);
        expect(isOpen('center')).toBe(false);
    });

    test('toque en Android: el click (detail 0) que sigue al pointerup no vuelve a cerrar el menú', () => {
        mount();
        const center = $('[data-bnav-center]');
        pointer('pointerdown', center); pointer('pointerup', center);
        center.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
        expect(isOpen('center')).toBe(true);
    });

    test('teclado: Enter sobre el botón central abre el menú', () => {
        mount();
        const center = $('[data-bnav-center]');
        center.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
        expect(isOpen('center')).toBe(true);
    });

    test('Foto de factura abre la cámara y guarda la foto en caja chica', () => {
        mount();
        const center = $('[data-bnav-center]');
        center.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
        const input = () => document.querySelector('[data-bnav-photo-input]');
        const click = jest.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
        $('[data-bnav-capture="photo"]').click();
        expect(click).toHaveBeenCalledTimes(1);
        expect(input().accept).toBe('image/*');
        expect(input().getAttribute('capture')).toBe('environment');

        Object.defineProperty(input(), 'files', { value: [new File(['x'], 'f.jpg', { type: 'image/jpeg' })], configurable: true });
        input().dispatchEvent(new Event('change'));
        expect(env.calls).toEqual([['changeTab', 'pettycash'], ['pcCameraBatchPhoto', input()]]);
        click.mockRestore();
    });

    test('con la cámara nueva activa, Foto de factura va a Caja chica y la abre', () => {
        const openCamera = jest.fn();
        mount({ inAppCamera: { useInAppCamera: () => true, openCamera } });
        const click = jest.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
        $('[data-bnav-capture="photo"]').click();
        expect(click).not.toHaveBeenCalled();
        expect(env.calls).toEqual([['changeTab', 'pettycash']]);
        expect(openCamera).toHaveBeenCalledTimes(1);
        click.mockRestore();
    });

    test('Foto de factura sin periodo abierto lleva a caja chica y lo explica', () => {
        const { notify } = mount({ canCapture: false });
        const click = jest.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
        $('[data-bnav-capture="photo"]').click();
        expect(click).not.toHaveBeenCalled();
        expect(env.calls).toEqual([['changeTab', 'pettycash']]);
        expect(notify).toHaveBeenCalledWith(expect.stringContaining('periodo'), 'info');
        click.mockRestore();
    });

    test('Buscar empleado abre Personal y enfoca el buscador', async () => {
        mount();
        $('[data-bnav-capture="search"]').click();
        expect(env.calls).toEqual([['openEmpleadosPersonal']]);
        const input = document.createElement('input');
        input.className = 'employee-search-input';
        document.body.appendChild(input);
        await new Promise(r => setTimeout(r, 40));
        expect(document.activeElement).toBe(input);
    });

    test('al cambiar la conexión vuelve a dibujar la barra', () => {
        mount();
        const handlers = Object.fromEntries(env.win.addEventListener.mock.calls.map(([type, fn]) => [type, fn]));
        expect(Object.keys(handlers)).toEqual(expect.arrayContaining(['online', 'offline']));
        document.body.innerHTML = '';
        handlers.offline();
        expect(document.querySelector('[data-bnav]')).not.toBeNull();
    });

    test('permiso de micrófono: avisa solo cuando cambia y tolera navegadores sin la API', async () => {
        const status = { state: 'prompt', onchange: null };
        const onChange = jest.fn();
        const read = watchMicPermission({ nav: { permissions: { query: () => Promise.resolve(status) } }, onChange });
        await Promise.resolve(); await Promise.resolve();
        expect(read()).toBe(false);
        expect(onChange).not.toHaveBeenCalled();
        status.state = 'denied'; status.onchange();
        expect(read()).toBe(true);
        expect(onChange).toHaveBeenCalledWith(true);
        status.state = 'denied'; status.onchange();
        expect(onChange).toHaveBeenCalledTimes(1);

        expect(watchMicPermission({ nav: {} })()).toBe(false);
        expect(watchMicPermission({ nav: { permissions: { query: () => { throw new Error('x'); } } } })()).toBe(false);
        const rejected = watchMicPermission({ nav: { permissions: { query: () => Promise.reject(new Error('no')) } } });
        await Promise.resolve();
        expect(rejected()).toBe(false);
    });

    test('sectionOfItem cubre todas las pantallas', () => {
        for (const section of NAV_SECTIONS) for (const item of section.items) expect(sectionOfItem(item.id)).toBe(section.id);
    });
});
