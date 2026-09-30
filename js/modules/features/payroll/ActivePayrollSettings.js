/**
 * ⚙️ ActivePayrollSettings — la configuración de nómina de la OBRA ACTIVA,
 * disponible de forma síncrona para la interfaz.
 *
 * Ajustes → Calendario edita la configuración de cada obra (período de pago,
 * horas por día, feriados, factores), pero la asistencia, el panel lateral, las
 * métricas de las tarjetas, el calendario y los préstamos seguían leyendo la
 * configuración general antigua (state.settings). El período configurado para
 * la obra no llegaba a esas pantallas.
 *
 * getActivePayrollSettings(state) devuelve state.settings con los campos de la
 * obra activa encima. Sin obras activas, o mientras la configuración no está
 * cargada, devuelve state.settings tal cual (comportamiento anterior).
 */
import { isProjectsEnabled } from '../../config/FeatureFlags.js';
import { peekEntityScope } from '../projects/EntityProjectScope.js';
import { subscribeActiveProject } from '../projects/ProjectContext.js';
import * as configStore from './ProjectPayrollConfigStore.js';
import { setPayrollSettingsResolver } from '../../core/AppState.js';

// Mismos campos que PROJECT_PAYROLL_UI_CONFIG_FIELDS (ProjectPayrollUIRuntime);
// una prueba verifica que no se desalineen.
export const ACTIVE_PAYROLL_SETTING_FIELDS = Object.freeze([
    'regularHoursPerDay', 'overtimeFactor', 'holidayFactor', 'holidays', 'payPeriod', 'defaultDeductionPercentage'
]);

let cache = { projectId: null, config: null };
let inFlight = null;

const activeProjectId = () => {
    const pid = peekEntityScope()?.projectId;
    return pid ? String(pid).trim() : null;
};

// Se llama en bucles de render (por día y por empleado): la vista se reutiliza
// mientras no cambien los ajustes generales ni la configuración de la obra.
let memo = { base: null, config: null, view: null };

export function getActivePayrollSettings(state) {
    const base = state?.settings || {};
    if (!isProjectsEnabled()) return base;
    const pid = activeProjectId();
    if (!pid || cache.projectId !== pid || !cache.config) return base;
    if (memo.base === base && memo.config === cache.config && memo.view) return memo.view;
    const view = { ...base };
    for (const field of ACTIVE_PAYROLL_SETTING_FIELDS) {
        if (cache.config[field] !== undefined && cache.config[field] !== null) view[field] = cache.config[field];
    }
    memo = { base, config: cache.config, view };
    return view;
}

/**
 * Horas base por día (dateKey → horas) de la obra activa. Mientras la obra no
 * tenga las suyas, se usan las generales (datos anteriores a multi-obra).
 */
export function getActiveDayHours(state) {
    const base = state?.dayHoursConfig || {};
    if (!isProjectsEnabled()) return base;
    const pid = activeProjectId();
    if (!pid || cache.projectId !== pid || !cache.config) return base;
    const own = cache.config.dayHours;
    return own && typeof own === 'object' ? own : base;
}

/**
 * Guarda horas base por día en la configuración de la obra activa y la
 * publica (payroll-config:changed). Devuelve false sin obras activas.
 */
export async function updateActiveDayHours(updates, { state = null, store = configStore } = {}) {
    if (!isProjectsEnabled()) return false;
    const pid = activeProjectId();
    if (!pid) return false;
    const current = cache.projectId === pid && cache.config ? cache.config : await store.getConfig(pid);
    if (!current) return false;
    const dayHours = { ...getActiveDayHours(state || { dayHoursConfig: {} }), ...(current.dayHours || {}), ...updates };
    // Vista inmediata; luego se persiste.
    setActivePayrollConfig({ ...current, dayHours });
    const saved = await store.putConfig({ ...current, dayHours });
    setActivePayrollConfig(saved);
    try {
        if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('payroll-config:changed', { detail: { config: saved } }));
    } catch (_) { /* sin UI */ }
    return true;
}

/** Feriados de la obra activa (o los generales sin obras). */
export function getActiveHolidays(state) {
    const holidays = getActivePayrollSettings(state).holidays;
    return Array.isArray(holidays) ? holidays : [];
}

function rerender() {
    try { if (typeof globalThis.render === 'function') globalThis.render(); } catch (_) { /* sin UI */ }
}

/** Fija la configuración recién guardada sin esperar a leer IndexedDB. */
export function setActivePayrollConfig(config, { render = true } = {}) {
    const pid = String(config?.projectId ?? '').trim();
    if (!pid) return;
    const changed = cache.projectId !== pid || JSON.stringify(cache.config) !== JSON.stringify(config);
    cache = { projectId: pid, config: JSON.parse(JSON.stringify(config)) };
    if (changed && render && pid === activeProjectId()) rerender();
}

/** Carga la configuración de la obra activa; vuelve a pintar si cambió. */
export async function refreshActivePayrollSettings({ render = true, store = configStore } = {}) {
    if (!isProjectsEnabled()) return null;
    const pid = activeProjectId();
    if (!pid) return null;
    if (inFlight?.pid === pid) return inFlight.promise;
    const promise = (async () => {
        try {
            const config = await store.getConfig(pid);
            if (config && pid === activeProjectId()) setActivePayrollConfig(config, { render });
            return config;
        } catch (_) {
            return null;
        } finally {
            if (inFlight?.pid === pid) inFlight = null;
        }
    })();
    inFlight = { pid, promise };
    return promise;
}

export function resetActivePayrollSettingsForTests() {
    cache = { projectId: null, config: null };
    memo = { base: null, config: null, view: null };
    inFlight = null;
}

setPayrollSettingsResolver(getActivePayrollSettings);

if (typeof window !== 'undefined') {
    for (const eventName of ['projects:setup-changed', 'payroll-config:changed']) {
        window.addEventListener(eventName, event => {
            if (event?.detail?.config?.projectId) setActivePayrollConfig(event.detail.config);
            else refreshActivePayrollSettings().catch(() => {});
        });
    }
    try { subscribeActiveProject(() => { refreshActivePayrollSettings().catch(() => {}); }); } catch (_) { /* sin contexto */ }
}
