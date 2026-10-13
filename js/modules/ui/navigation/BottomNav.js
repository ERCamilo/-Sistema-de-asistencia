/**
 * BottomNav — barra inferior de 5 posiciones (móvil, < 1024 px).
 *
 *   Asistencia · Personal · [botón central] · Finanzas · Más
 *
 * Cada sección agrupa sus pantallas. Cómo se navega depende del ajuste
 * `navStyle` (Configuración → Tests); en todos se recuerda la última
 * pantalla usada de cada sección:
 *   - subbar (por defecto): tocar una sección abre su última pantalla y
 *     muestra encima una mini barra horizontal con sus pantallas. "Más" usa
 *     el menú vertical: abre su última pantalla y muestra el menú.
 *   - menu: tocar una sección solo abre su menú; se cambia al elegir.
 *   - twotap: el primer toque abre la última pantalla; tocar la sección
 *     activa abre el menú.
 * Con el modo desarrollador, "Más" incluye Tests.
 *
 * El botón central es de captura rápida y se adapta (ajuste
 * `navCenterMode`: auto | plus | mic):
 *   - micrófono: mantener pulsado dicta (Voz); tocar abre el menú de captura.
 *   - "+": tocar abre el menú de captura (foto de factura, buscar empleado
 *     y, si Voz está disponible, dictar).
 *   En automático se usa el micrófono solo con Voz activa, conexión y
 *   permiso de micrófono; si falta algo, "+".
 *
 * El estado abierto/cerrado de los menús vive en este módulo (no en
 * AppState): abrir o cerrar no dispara render(). El HTML que devuelve
 * renderBottomNav() refleja ese estado, así un render() a mitad de camino
 * no cierra el menú ni repite la animación.
 *
 * Probado en js/tests/BottomNav.test.js.
 */

import { createHoldGuard, preventTouchDefaults } from '../HoldGuard.js';
import { isDeveloperMode } from '../settings/DeveloperMode.js';

const svg = (d, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra}><path d="${d}"/></svg>`;

const ICONS = {
    asistencia: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
    personal: 'M9 11.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a5 5 0 0 1 3.5 6',
    finanzas: 'M2.5 6h19v13h-19zM12 15a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM6 9.5v6M18 9.5v6',
    mas: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
    'attendance-day': 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4M10 14h4v3h-4z',
    'attendance-week': 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4M7 14h10M7 17h6',
    employees: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a5 5 0 0 1 3.5 6',
    positions: 'M3 8h18v11H3zM9 8V5h6v3M3 13h18',
    leaders: 'M12 3l2.7 5.5 6 .9-4.4 4.2 1 6-5.3-2.8-5.3 2.8 1-6L3.3 9.4l6-.9z',
    payroll: 'M3 6h18v13H3zM12 15.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 9.5v6M18 9.5v6',
    loans: 'M12 3v18M16.5 7.5c0-1.7-2-3-4.5-3s-4.5 1.3-4.5 3 2 2.6 4.5 3 4.5 1.3 4.5 3-2 3-4.5 3-4.5-1.3-4.5-3',
    pettycash: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6',
    history: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2',
    reports: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
    calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4M8 14h.01M12 14h.01M16 14h.01M8 17h.01M12 17h.01',
    settings: 'M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1M15 4v4M9 10v4M17 16v4',
    tests: 'M9 3h6M10 3v6L4.5 18.5A1.7 1.7 0 0 0 6 21h12a1.7 1.7 0 0 0 1.5-2.5L14 9V3M7 15h10',
    data: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
    mic: 'M9 5a3 3 0 0 1 6 0v6a3 3 0 0 1-6 0zM5 10v1a7 7 0 0 0 14 0v-1M12 18v3M8 21h8',
    plus: 'M12 5v14M5 12h14',
    photo: 'M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1zM12 17a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
    search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-3.5-3.5',
    check: 'M5 12.5l4.5 4.5L19 7.5'
};

/** Secciones en el orden de la barra. `slot` = posición (0–4; el 2 es el botón central). */
export const NAV_SECTIONS = Object.freeze([
    { id: 'asistencia', label: 'Asistencia', slot: 0, items: [
        { id: 'attendance-day', label: 'Diaria', desc: 'Marcar el día de hoy' },
        { id: 'attendance-week', label: 'Semanal', desc: 'Toda la semana de un vistazo' }
    ] },
    { id: 'personal', label: 'Personal', slot: 1, items: [
        { id: 'employees', label: 'Empleados', desc: 'Fichas y datos' },
        { id: 'positions', label: 'Posiciones', desc: 'Cargos y tarifas' },
        { id: 'leaders', label: 'Líderes', desc: 'Encargados de cuadrilla' }
    ] },
    { id: 'finanzas', label: 'Finanzas', slot: 3, items: [
        { id: 'payroll', label: 'Nómina', desc: 'Cálculo y pago' },
        { id: 'loans', label: 'Préstamos', desc: 'Saldos y cobros' },
        { id: 'pettycash', label: 'Caja chica', desc: 'Gastos y facturas' }
    ] },
    { id: 'mas', label: 'Más', slot: 4, items: [
        { id: 'reports', label: 'Reportes', desc: 'Estadísticas' },
        { id: 'history', label: 'Historial', desc: 'Pagos anteriores' },
        { id: 'calendar', label: 'Calendario', desc: 'Feriados y periodos' },
        { id: 'settings', label: 'Ajustes', desc: 'Preferencias de la app' },
        { id: 'data', label: 'Datos', desc: 'Respaldo y sincronización' }
    ] }
]);

/** Solo con el modo desarrollador (tocar 7 veces la versión), al final de "Más". */
const TESTS_ITEM = Object.freeze({ id: 'tests', label: 'Tests', desc: 'Pruebas y diagnóstico' });

/** Secciones visibles: con el modo desarrollador, "Más" suma Tests. */
export function navSections({ devMode = false } = {}) {
    if (!devMode) return NAV_SECTIONS;
    return NAV_SECTIONS.map(section => section.id === 'mas' ? { ...section, items: [...section.items, TESTS_ITEM] } : section);
}

const SECTION_BY_ID = new Map(NAV_SECTIONS.map(section => [section.id, section]));
const SECTION_OF_ITEM = new Map([...NAV_SECTIONS.flatMap(section => section.items.map(item => [item.id, section.id])), [TESTS_ITEM.id, 'mas']]);

/**
 * Mini barra al desplazarse: se esconde al bajar (deja más pantalla) y
 * vuelve al subir o cerca del inicio. Los movimientos de menos de
 * SUBBAR_MIN_DELTA px no cuentan, para que no parpadee.
 */
const SUBBAR_TOP_ZONE = 80;
const SUBBAR_MIN_DELTA = 6;
const SUBBAR_TUCKED_CLASS = 'bnav-sub-tucked';
export function nextSubbarTucked({ tucked = false, y = 0, lastY = 0 } = {}) {
    if (y < SUBBAR_TOP_ZONE) return false;
    const delta = y - lastY;
    if (Math.abs(delta) < SUBBAR_MIN_DELTA) return tucked;
    return delta > 0;
}

/** Cómo se navega entre secciones (ajuste `navStyle`). */
export const NAV_STYLES = Object.freeze(['subbar', 'menu', 'twotap']);
export function resolveNavStyle(setting) {
    return NAV_STYLES.includes(setting) ? setting : 'subbar';
}

export const CENTER_MODES = Object.freeze(['auto', 'plus', 'mic']);
export const HOLD_TO_TALK_MS = 280;
const CLICK_AFTER_POINTER_MS = 700;
const LAST_ITEM_KEY = 'sa.bottomNav.lastItem';

/** Pantalla activa (id de ítem) según el estado de la app; null si no pertenece a la barra. */
export function activeNavItem(state = {}) {
    switch (state.activeTab) {
        case 'attendance': return state.viewMode === 'week' ? 'attendance-week' : 'attendance-day';
        case 'employees':
        case 'positions':
            if (state.employeeViewMode === 'leaders') return 'leaders';
            if (state.employeeViewMode === 'positions' || state.activeTab === 'positions') return 'positions';
            return 'employees';
        case 'export':
            if (state.payrollViewMode === 'ledger') return 'loans';
            if (state.payrollViewMode === 'history') return 'history';
            return 'payroll';
        case 'pettycash': return 'pettycash';
        case 'employee-report':
        case 'dashboard': return 'reports';
        case 'settings':
            if (state.settingsActiveTab === 'calendar') return 'calendar';
            if (state.settingsActiveTab === 'data') return 'data';
            if (state.settingsActiveTab === 'tests') return 'tests';
            return 'settings';
        default: return null;
    }
}

export function sectionOfItem(itemId) {
    return SECTION_OF_ITEM.get(itemId) || null;
}

/**
 * Qué muestra el botón central.
 * @returns {'mic'|'plus'}
 */
export function resolveCenterMode({ setting = 'auto', voiceAvailable = false, online = true, micDenied = false } = {}) {
    if (!voiceAvailable) return 'plus';
    if (setting === 'plus') return 'plus';
    if (setting === 'mic') return 'mic';
    return online && !micDenied ? 'mic' : 'plus';
}

/**
 * Lleva a una pantalla de la barra usando los atajos que ya existen en
 * window (los mismos que usa el menú lateral de escritorio).
 */
export function navigateToItem(itemId, { win = window, state = {} } = {}) {
    const call = (name, ...args) => (typeof win[name] === 'function' ? (win[name](...args), true) : false);
    switch (itemId) {
        case 'attendance-day':
        case 'attendance-week': {
            const mode = itemId === 'attendance-week' ? 'week' : 'day';
            if (state.activeTab !== 'attendance') call('changeTab', 'attendance');
            if ((state.viewMode || 'day') !== mode) call('changeViewMode', mode);
            return true;
        }
        case 'employees': return call('openEmpleadosPersonal');
        case 'positions': return call('openPuestosPersonal');
        case 'leaders': return call('openLideresPersonal');
        case 'payroll': return call('openNomina');
        case 'loans': return call('openCuentasPorCobrar');
        case 'history': return call('openHistorialNomina');
        case 'pettycash': return call('changeTab', 'pettycash');
        case 'reports': return call('changeTab', 'employee-report');
        case 'calendar': return call('openCalendarioAjustes');
        case 'settings': return call('openAjustesGenerales');
        case 'data': return call('openDatosAjustes');
        case 'tests': return call('openTestsAjustes');
        default: return false;
    }
}

// ── Estado local de la barra (no vive en AppState) ──────────────────────────
const ui = {
    openMenu: null,          // id de sección | 'center' | null
    centerMode: 'plus',
    navStyle: 'subbar',
    listening: false,
    arming: false,           // micrófono abriéndose: aún sin "Escuchando" (no hablar todavía)
    saved: false,            // ✓ breve tras guardar un audio (evento sa:voice-state)
    lastItems: null
};

function storage(win) {
    try { return win.localStorage || null; } catch (_) { return null; }
}

function readLastItems(win) {
    if (ui.lastItems) return ui.lastItems;
    let saved = {};
    try { saved = JSON.parse(storage(win)?.getItem(LAST_ITEM_KEY) || '{}') || {}; } catch (_) { saved = {}; }
    ui.lastItems = {};
    for (const section of NAV_SECTIONS) {
        const item = saved[section.id];
        ui.lastItems[section.id] = sectionOfItem(item) === section.id ? item : section.items[0].id;
    }
    return ui.lastItems;
}

export function rememberNavItem(itemId, { win = window } = {}) {
    const section = sectionOfItem(itemId);
    if (!section) return;
    const last = readLastItems(win);
    if (last[section] === itemId) return;
    last[section] = itemId;
    try { storage(win)?.setItem(LAST_ITEM_KEY, JSON.stringify(last)); } catch (_) { /* preferencia local, opcional */ }
}

export function lastNavItem(sectionId, { win = window } = {}) {
    return readLastItems(win)[sectionId] || SECTION_BY_ID.get(sectionId)?.items[0]?.id || null;
}

/** Solo para tests. */
export function _resetBottomNavState() {
    ui.openMenu = null; ui.centerMode = 'plus'; ui.navStyle = 'subbar'; ui.listening = false; ui.arming = false; ui.saved = false; ui.lastItems = null;
}

export function bottomNavOpenMenu() {
    return ui.openMenu;
}

// ── HTML ────────────────────────────────────────────────────────────────────
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function centerLabel(mode, listening) {
    if (listening) return 'Escuchando. Suelta o toca para terminar';
    return mode === 'mic'
        ? 'Captura rápida: toca para ver opciones, mantén pulsado para dictar'
        : 'Captura rápida: foto de factura o buscar empleado';
}

function menuHTML(section, activeItem) {
    const open = ui.openMenu === section.id;
    const center = `${section.slot * 20 + 10}%`;
    const items = section.items.map((item, i) => {
        const on = item.id === activeItem;
        return `<button type="button" class="bnav-item${on ? ' is-current' : ''}" role="menuitemradio" aria-checked="${on}" data-bnav-item="${item.id}" style="--i:${i}">
                <span class="bnav-item-icon">${svg(ICONS[item.id])}</span>
                <span class="bnav-item-copy"><span class="bnav-item-label">${esc(item.label)}</span><span class="bnav-item-desc">${esc(item.desc)}</span></span>
                ${on ? `<span class="bnav-item-check">${svg(ICONS.check)}</span>` : ''}
            </button>`;
    }).join('');
    return `<div class="bnav-pop" data-bnav-menu="${section.id}" data-open="${open}" style="--c:${center}">
            <div class="bnav-menu" id="bnav-menu-${section.id}" role="menu" aria-label="${esc(section.label)}">
                <div class="bnav-menu-head"><span>${esc(section.label)}</span><span>${section.items.length} pantallas</span></div>
                ${items}
            </div>
            <span class="bnav-caret" aria-hidden="true"></span>
        </div>`;
}

// Modo `subbar`: las pantallas de la sección activa, en fila sobre la barra.
function subbarHTML(section, activeItem) {
    const chips = section.items.map(item => {
        const on = item.id === activeItem;
        return `<button type="button" class="bnav-sub-item${on ? ' is-current' : ''}" data-bnav-item="${item.id}"${on ? ' aria-current="page"' : ''}>
                <span class="bnav-sub-icon">${svg(ICONS[item.id])}</span><span class="bnav-sub-label">${esc(item.label)}</span>
            </button>`;
    }).join('');
    return `<div class="bnav-sub" data-bnav-sub="${section.id}" role="group" aria-label="Pantallas de ${esc(section.label)}">${chips}</div>`;
}

function captureMenuHTML({ voiceAvailable }) {
    const open = ui.openMenu === 'center';
    const option = (id, icon, label, desc, i) => `<button type="button" class="bnav-item" role="menuitem" data-bnav-capture="${id}" style="--i:${i}">
                <span class="bnav-item-icon bnav-item-icon--${id}">${svg(ICONS[icon])}</span>
                <span class="bnav-item-copy"><span class="bnav-item-label">${label}</span><span class="bnav-item-desc">${desc}</span></span>
            </button>`;
    return `<div class="bnav-pop bnav-pop--center" data-bnav-menu="center" data-open="${open}" style="--c:50%">
            <div class="bnav-menu" id="bnav-menu-center" role="menu" aria-label="Captura rápida">
                <div class="bnav-menu-head"><span>Capturar</span></div>
                ${option('photo', 'photo', 'Foto de factura', 'Caja chica, aun sin conexión', 0)}
                ${option('search', 'search', 'Buscar empleado', 'Por nombre o número', 1)}
                ${voiceAvailable ? option('dictate', 'mic', 'Dictar', 'O mantén pulsado el botón', 2) : ''}
            </div>
            <span class="bnav-caret" aria-hidden="true"></span>
        </div>`;
}

/**
 * HTML de la barra.
 * @param {object} state  estado de la app (activeTab, viewMode, …, settings)
 * @param {object} env    { voiceAvailable, online, micDenied, win }
 */
export function renderBottomNav(state = {}, { voiceAvailable = false, online = true, micDenied = false, win = window } = {}) {
    const activeItem = activeNavItem(state);
    const activeSection = sectionOfItem(activeItem);
    if (activeItem) rememberNavItem(activeItem, { win });
    ui.centerMode = resolveCenterMode({ setting: state.settings?.navCenterMode || 'auto', voiceAvailable, online, micDenied });
    ui.navStyle = resolveNavStyle(state.settings?.navStyle);
    const mode = ui.centerMode;
    const sections = navSections({ devMode: isDeveloperMode(storage(win)) });
    // En `subbar` solo "Más" tiene menú vertical; las demás usan la mini barra.
    const usesMenu = (section) => ui.navStyle !== 'subbar' || section.id === 'mas';
    const subSection = ui.navStyle === 'subbar' && activeSection && activeSection !== 'mas'
        ? sections.find(section => section.id === activeSection) : null;

    const tab = (section) => {
        const active = section.id === activeSection;
        const expanded = ui.openMenu === section.id;
        return `<button type="button" class="bottom-nav-tab bnav-tab${active ? ' active' : ''}" data-bnav-section="${section.id}"
                    ${usesMenu(section) ? `aria-haspopup="menu" aria-expanded="${expanded}" aria-controls="bnav-menu-${section.id}"` : ''}${active ? ' aria-current="page"' : ''}>
                    <span class="bottom-nav-icon">${svg(ICONS[section.id])}</span>
                    <span class="bottom-nav-text">${esc(section.label)}</span>
                </button>`;
    };
    const [asistencia, personal, finanzas, mas] = sections;

    return `<nav class="bottom-nav bnav glass-effect" aria-label="Navegación principal" data-bnav>
            ${tab(asistencia)}
            ${tab(personal)}
            <div class="bnav-center-slot">
                <button type="button" class="bnav-center${ui.listening ? ' is-listening' : ''}${ui.saved ? ' is-saved' : ''}" data-bnav-center data-mode="${mode}"
                        aria-haspopup="menu" aria-expanded="${ui.openMenu === 'center'}" aria-controls="bnav-menu-center"
                        aria-pressed="${ui.listening}" aria-label="${centerLabel(mode, ui.listening)}">
                    <span class="bnav-center-icon bnav-center-icon--mic">${svg(ICONS.mic, ' stroke-width="2"')}</span>
                    <span class="bnav-center-icon bnav-center-icon--plus">${svg(ICONS.plus, ' stroke-width="2.4"')}</span>
                    <span class="bnav-center-icon bnav-center-icon--check">${svg(ICONS.check, ' stroke-width="2.8"')}</span>
                </button>
            </div>
            ${tab(finanzas)}
            ${tab(mas)}
            ${subSection ? subbarHTML(subSection, activeItem) : ''}
            ${sections.filter(usesMenu).map(section => menuHTML(section, activeItem)).join('')}
            ${captureMenuHTML({ voiceAvailable })}
        </nav>`;
}

// ── Comportamiento ──────────────────────────────────────────────────────────
function syncMenus(doc) {
    for (const pop of doc.querySelectorAll('[data-bnav-menu]')) {
        pop.dataset.open = String(pop.dataset.bnavMenu === ui.openMenu);
    }
    for (const button of doc.querySelectorAll('[data-bnav-section]')) {
        button.setAttribute('aria-expanded', String(button.dataset.bnavSection === ui.openMenu));
    }
    const center = doc.querySelector('[data-bnav-center]');
    if (center) center.setAttribute('aria-expanded', String(ui.openMenu === 'center'));
}

function syncCenter(doc) {
    const center = doc.querySelector('[data-bnav-center]');
    if (!center) return;
    center.dataset.mode = ui.centerMode;
    center.classList.toggle('is-listening', ui.listening);
    center.classList.toggle('is-arming', ui.arming && !ui.listening);
    center.classList.toggle('is-saved', ui.saved);
    center.setAttribute('aria-pressed', String(ui.listening));
    center.setAttribute('aria-label', centerLabel(ui.centerMode, ui.listening));
}

/**
 * Conecta la barra al documento (una sola vez).
 *
 * @param {object} deps
 * @param {Document} [deps.doc]
 * @param {Window}   [deps.win]
 * @param {() => object} deps.getState
 * @param {object}   [deps.voice]  { isAvailable(), startHold(), endHold(), cancelHold(), warmUp?(), releaseWarm?() }
 * @param {object}   [deps.pettyCash] { canCapture() }
 * @param {(msg: string, type?: string) => void} [deps.notify]
 * @param {() => void} [deps.refresh] vuelve a dibujar (cambio de conexión/permiso)
 * @returns {{ destroy(): void, setMicDenied(v: boolean): void }}
 */
export function initBottomNav({ doc = document, win = window, getState, voice = null, pettyCash = null, notify = () => {}, refresh = () => {} } = {}) {
    let holdTimer = null;
    let pressing = false;
    // Mientras se mantiene el botón central: sin selección, menú ni arrastre del sistema.
    const holdGuard = createHoldGuard({ doc });
    const releaseTouch = preventTouchDefaults(doc, '[data-bnav-center]');
    let holding = false;
    let toggleRecording = false;
    let photoInput = null;
    let lastPointerUp = 0;

    const state = () => getState?.() || {};
    const setOpen = (menu) => { ui.openMenu = menu; syncMenus(doc); };
    const close = () => { if (ui.openMenu) setOpen(null); };
    const setListening = (on) => { ui.listening = on; if (!on) ui.arming = false; syncCenter(doc); };
    const setArming = (on) => { ui.arming = on; syncCenter(doc); };

    // Última pantalla de la sección, si sigue visible (Tests sin modo desarrollador no).
    const lastVisibleItem = (sectionId) => {
        const section = navSections({ devMode: isDeveloperMode(storage(win)) }).find(s => s.id === sectionId);
        const last = lastNavItem(sectionId, { win });
        return section?.items.some(item => item.id === last) ? last : section?.items[0]?.id;
    };
    const toggleMenu = (sectionId) => setOpen(ui.openMenu === sectionId ? null : sectionId);
    const goToSection = (sectionId, { openMenu = false } = {}) => {
        setOpen(openMenu ? sectionId : null);
        navigateToItem(lastVisibleItem(sectionId), { win, state: state() });
    };

    const onSection = (sectionId) => {
        const active = sectionId === sectionOfItem(activeNavItem(state()));
        const style = ui.navStyle;
        // Primero el menú; se cambia de pantalla al elegir.
        if (style === 'menu') { toggleMenu(sectionId); return; }
        // Segundo toque sobre la sección activa: su menú.
        if (style === 'twotap') { if (active) toggleMenu(sectionId); else goToSection(sectionId); return; }
        // subbar: "Más" como siempre (menú vertical); las demás, mini barra.
        if (sectionId === 'mas') { if (active) toggleMenu(sectionId); else goToSection(sectionId, { openMenu: true }); return; }
        if (active) close(); else goToSection(sectionId);
    };

    const onItem = (itemId) => {
        rememberNavItem(itemId, { win });
        close();
        if (itemId !== activeNavItem(state())) navigateToItem(itemId, { win, state: state() });
    };

    const capturePhoto = () => {
        if (!pettyCash?.canCapture?.()) {
            navigateToItem('pettycash', { win, state: state() });
            notify('Abre o elige un periodo de caja chica para agregar facturas.', 'info');
            return;
        }
        // Cámara a pantalla completa (prueba en Configuración → Tests).
        if (pettyCash.useInAppCamera?.()) {
            if (state().activeTab !== 'pettycash') navigateToItem('pettycash', { win, state: state() });
            pettyCash.openCamera?.();
            return;
        }
        if (!photoInput) {
            photoInput = doc.createElement('input');
            photoInput.type = 'file';
            photoInput.accept = 'image/*';
            photoInput.setAttribute('capture', 'environment');
            photoInput.hidden = true;
            photoInput.dataset.bnavPhotoInput = '';
            photoInput.addEventListener('change', () => {
                if (!photoInput.files?.length) return;
                if (state().activeTab !== 'pettycash') navigateToItem('pettycash', { win, state: state() });
                win.pcCameraBatchPhoto?.(photoInput);
            });
            doc.body.appendChild(photoInput);
        }
        // Debe ocurrir dentro del gesto del usuario para que se abra la cámara.
        photoInput.click();
    };

    const searchEmployee = () => {
        navigateToItem('employees', { win, state: state() });
        let tries = 0;
        const focus = () => {
            const input = doc.querySelector('.employee-search-input');
            if (input) { input.focus(); return; }
            if (++tries < 40) (win.requestAnimationFrame || win.setTimeout)(focus, 16);
        };
        focus();
    };

    const startVoice = (options) => {
        if (!voice?.isAvailable?.()) return false;
        close();
        // "Escuchando" llega con el evento sa:voice-state cuando ya se graba.
        setArming(true);
        Promise.resolve(voice.startHold(options)).catch(() => false).then((recording) => {
            if (recording !== false) return;
            // Voz ya avisó el motivo; soltar después no debe abrir el menú.
            holding = false; toggleRecording = false; pressing = false;
            setListening(false);
        });
        return true;
    };
    const stopVoice = () => {
        setListening(false);
        voice?.endHold?.();
    };

    const onCapture = (id) => {
        close();
        if (id === 'photo') capturePhoto();
        else if (id === 'search') searchEmployee();
        else if (id === 'dictate' && startVoice({ toggle: true })) {
            toggleRecording = true;
            notify('Grabando. Toca el botón central para terminar.', 'info');
        }
    };

    const onClick = (event) => {
        const target = event.target;
        if (!target?.closest) return;
        const section = target.closest('[data-bnav-section]');
        if (section) { onSection(section.dataset.bnavSection); return; }
        const item = target.closest('[data-bnav-item]');
        if (item) { onItem(item.dataset.bnavItem); return; }
        const capture = target.closest('[data-bnav-capture]');
        if (capture) { onCapture(capture.dataset.bnavCapture); return; }
        const center = target.closest('[data-bnav-center]');
        // Los toques ya se resolvieron en pointerup; el click que les sigue
        // se ignora (Chrome Android lo envía con detail 0, como el teclado).
        if (center && Date.now() - lastPointerUp < CLICK_AFTER_POINTER_MS) return;
        if (center && event.detail === 0) {
            if (toggleRecording) { toggleRecording = false; stopVoice(); return; }
            setOpen(ui.openMenu === 'center' ? null : 'center');
        }
    };

    const onPointerDown = (event) => {
        const target = event.target;
        const center = target?.closest?.('[data-bnav-center]');
        if (!center) {
            if (ui.openMenu && !target?.closest?.('[data-bnav-menu], [data-bnav-section]')) close();
            return;
        }
        if (event.button !== undefined && event.button !== 0) return;
        event.preventDefault();
        pressing = true; holding = false;
        holdGuard.start();
        center.setPointerCapture?.(event.pointerId);
        clearTimeout(holdTimer);
        if (!toggleRecording && ui.centerMode === 'mic' && voice?.isAvailable?.()) {
            // Abre el micrófono ya; si resulta ser un toque se suelta.
            voice.warmUp?.();
            holdTimer = setTimeout(() => {
                if (!pressing) return;
                holding = startVoice();
            }, HOLD_TO_TALK_MS);
        }
    };

    const onPointerUp = (event) => {
        if (pressing) holdGuard.end(); // aunque el dedo termine fuera del botón
        if (!pressing || !event.target?.closest?.('[data-bnav-center]')) return;
        pressing = false;
        holdGuard.end();
        lastPointerUp = Date.now();
        clearTimeout(holdTimer);
        if (holding) { holding = false; stopVoice(); return; }
        if (toggleRecording) { toggleRecording = false; stopVoice(); return; }
        voice?.releaseWarm?.();
        setOpen(ui.openMenu === 'center' ? null : 'center');
    };

    const onPointerCancel = () => {
        holdGuard.end();
        if (!pressing) return;
        pressing = false;
        clearTimeout(holdTimer);
        if (holding) { holding = false; setListening(false); voice?.cancelHold?.(); }
        else voice?.releaseWarm?.();
    };

    const onKey = (event) => {
        if (event.key === 'Escape' && ui.openMenu) close();
    };
    const onContextMenu = (event) => {
        if (event.target?.closest?.('[data-bnav-center]')) event.preventDefault();
    };
    const onConnectivity = () => refresh();
    const onResize = () => close();
    // Estado real de la grabación (VoiceMvpUI.setCaptureState).
    const onVoiceState = (event) => {
        const state = event?.detail?.state;
        if (state === 'arming') { ui.arming = true; syncCenter(doc); return; }
        ui.saved = state === 'saved';
        ui.arming = false;
        if (state === 'listening') ui.listening = true;
        else {
            // Terminó o falló mientras se mantenía pulsado: soltar no debe abrir el menú.
            if (holding || toggleRecording) pressing = false;
            ui.listening = false; holding = false; toggleRecording = false;
        }
        syncCenter(doc);
    };
    const view = doc.defaultView || win;

    doc.addEventListener('click', onClick);
    doc.addEventListener('pointerdown', onPointerDown);
    doc.addEventListener('pointerup', onPointerUp);
    doc.addEventListener('pointercancel', onPointerCancel);
    doc.addEventListener('keydown', onKey);
    doc.addEventListener('contextmenu', onContextMenu);
    win.addEventListener?.('online', onConnectivity);
    win.addEventListener?.('offline', onConnectivity);
    win.addEventListener?.('resize', onResize);
    view.addEventListener?.('sa:voice-state', onVoiceState);

    let lastScrollY = win.scrollY || 0;
    let subTucked = false;
    const onScroll = () => {
        const y = win.scrollY || 0;
        const next = nextSubbarTucked({ tucked: subTucked, y, lastY: lastScrollY });
        if (Math.abs(y - lastScrollY) >= SUBBAR_MIN_DELTA || y < SUBBAR_TOP_ZONE) lastScrollY = y;
        if (next === subTucked) return;
        subTucked = next;
        doc.body?.classList.toggle(SUBBAR_TUCKED_CLASS, next);
    };
    win.addEventListener?.('scroll', onScroll, { passive: true });

    return {
        destroy() {
            clearTimeout(holdTimer);
            holdGuard.end();
            releaseTouch();
            doc.removeEventListener('click', onClick);
            doc.removeEventListener('pointerdown', onPointerDown);
            doc.removeEventListener('pointerup', onPointerUp);
            doc.removeEventListener('pointercancel', onPointerCancel);
            doc.removeEventListener('keydown', onKey);
            doc.removeEventListener('contextmenu', onContextMenu);
            win.removeEventListener?.('online', onConnectivity);
            win.removeEventListener?.('offline', onConnectivity);
            win.removeEventListener?.('resize', onResize);
            view.removeEventListener?.('sa:voice-state', onVoiceState);
            win.removeEventListener?.('scroll', onScroll);
            doc.body?.classList.remove(SUBBAR_TUCKED_CLASS);
            photoInput?.remove();
        }
    };
}

/**
 * Observa el permiso de micrófono (donde el navegador lo expone) y avisa
 * cuando cambia. Devuelve una función para leer el último valor.
 */
export function watchMicPermission({ nav = globalThis.navigator, onChange = () => {} } = {}) {
    let denied = false;
    try {
        nav?.permissions?.query?.({ name: 'microphone' })
            .then((status) => {
                // Solo avisa cuando cambia: al arrancar casi siempre es "no denegado".
                const update = () => {
                    const next = status.state === 'denied';
                    if (next === denied) return;
                    denied = next;
                    onChange(denied);
                };
                update();
                status.onchange = update;
            })
            .catch(() => {});
    } catch (_) { /* navegador sin Permissions API para micrófono */ }
    return () => denied;
}
