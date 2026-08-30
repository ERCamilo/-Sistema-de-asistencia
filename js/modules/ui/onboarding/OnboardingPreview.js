/**
 * OnboardingPreview.js — arnés/host del onboarding v2. Monta un overlay fijo con
 * renderOnboarding/handleAction sobre un estado restaurado de localStorage
 * ('onboarding-pos'). Dos modos de apertura:
 *   - mode 'preview' (default): desde Ajustes → Tests, con badge "VISTA PREVIA".
 *   - mode 'live': arranque real de la app vía launchOnboardingV2, sin badge.
 * El RENDER de la app queda aislado (nunca llama al RenderManager global), pero las
 * cuatro opciones de elección ejecutan acciones REALES vía OnboardingActions con
 * deps por defecto. El progreso se persiste vía OnboardingCore (saveProgress), así
 * que cerrar a mitad de flujo permite retomarlo después.
 *
 * Reopen safety: al abrir se snapshottea el valor previo de 'onboardingCompleted';
 * si el cierre NO proviene de completar el flujo en esta sesión (choice action /
 * applySetup / skip → notifyCompleted), el snapshot se restaura al cerrar, para que
 * cerrar a mitad no marque al usuario como "ya onboarded" ni resucite la guía en
 * cada recarga cuando ya la había completado antes.
 */
import { defaultState, saveProgress, restoreProgress, clearProgress, navNext, navBack, canAdvance, SETUP_TOTAL } from './OnboardingCore.js';
import { renderOnboarding, handleAction } from './OnboardingView.js';
import { executeChoiceAction, markCompleted, COMPLETED_KEY } from './OnboardingActions.js';
import { applySetup } from './OnboardingApply.js';

let overlayEl = null;
let st = null;
let escHandler = null;
let running = false;
let prevFocus = null;
let hostMode = 'preview';
let completedSnapshot = null;
let justCompleted = false;

/* Accesibilidad del diálogo: foco atrapado dentro del overlay mientras está abierto. */
const FOCUSABLE_SEL = 'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])';
export function getOverlayFocusable(root) {
    return Array.from(root.querySelectorAll(FOCUSABLE_SEL));
}
export function trapTabKey(e, root) {
    const items = getOverlayFocusable(root);
    if (!items.length || !root.contains(document.activeElement)) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

const CHOICE_SOURCES = ['demo', 'scratch', 'backup', 'google'];
const STATUS_OK = 'Ejecutando…';

const PREVIEW_BADGE = '<span style="display:inline-flex;align-items:center;height:26px;padding:0 11px;border-radius:20px;background:#334155;border:1px solid #475569;color:#e2e8f0;font-size:11px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;white-space:nowrap;">VISTA PREVIA · las acciones modifican datos reales</span>';

/* Chrome del overlay: estado async + botón de cierre siempre; el badge de vista
 * previa SOLO en modo preview (el arranque live es el onboarding de verdad). */
function buildChrome() {
    return '<div data-od-preview-chrome style="position:absolute;top:12px;right:14px;z-index:2;display:flex;align-items:center;gap:10px;">'
        + '<span data-od-preview-status style="display:none;align-items:center;height:26px;padding:0 11px;border-radius:20px;background:#334155;border:1px solid #475569;color:#06b6d4;font-size:11px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;white-space:nowrap;"></span>'
        + (hostMode === 'preview' ? PREVIEW_BADGE : '')
        + '<button type="button" data-act="closePreview" aria-label="Cerrar vista previa" title="Cerrar vista previa" style="width:32px;height:32px;border-radius:50%;border:1px solid #475569;background:#1e293b;color:#94a3b8;font-size:18px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;">×</button>'
        + '</div>';
}

function readCompletedFlag() {
    try { return localStorage.getItem(COMPLETED_KEY); } catch (e) { return null; }
}

function restoreCompletedFlag() {
    try {
        if (completedSnapshot === null) localStorage.removeItem(COMPLETED_KEY);
        else localStorage.setItem(COMPLETED_KEY, completedSnapshot);
    } catch (e) { /* storage no disponible */ }
}

/* Marca la finalización DENTRO de la sesión abierta (choice actions, applySetup o
 * skip): fija el flag en storage Y evita que el cierre posterior restaure el
 * snapshot anterior sobre lo recién completado. */
export function notifyCompleted(storage = localStorage) {
    justCompleted = true;
    markCompleted(storage);
}

function showStatus(text) {
    if (!overlayEl) return;
    const el = overlayEl.querySelector('[data-od-preview-status]');
    if (!el) return;
    el.textContent = text;
    el.style.display = 'inline-flex';
}

function setButtonsDisabled(disabled) {
    if (!overlayEl) return;
    overlayEl.querySelectorAll('button').forEach(b => {
        b.disabled = disabled;
        b.style.pointerEvents = disabled ? 'none' : '';
    });
}

/* Ejecuta una opción de elección con sus deps REALES. Mientras corre: botones
 * deshabilitados + texto de estado; al completar se cierra el arnés; en error
 * se muestra la línea inline del choice (state._choiceError). */
async function runChoice(value) {
    if (running || !st || !overlayEl) return;
    running = true;
    st._choiceError = null;
    st._busy = true;
    renderPreview();
    showStatus(STATUS_OK);
    setButtonsDisabled(true);
    let result;
    try {
        result = await executeChoiceAction(value, st);
    } catch (err) {
        result = { completed: false, error: String((err && err.message) || err) };
    }
    running = false;
    if (!overlayEl || !st) return; // cerrado a mitad (Escape): nada más que tocar
    st._busy = false;
    if (result && result.completed) { notifyCompleted(); closeOnboardingPreview(); return; }
    st._choiceError = (result && result.error) || 'No se pudo completar la acción.';
    renderPreview();
}

/* "Finalizar" del setup: commit REAL vía applySetup (deps por defecto). Con
 * éxito avanza a 'listo' y re-renderiza SIN cerrar (el cierre queda para
 * "Entrar a la app"); en fallo muestra el error inline y se queda en setup. */
async function runFinish() {
    if (running || !st || !overlayEl) return;
    running = true;
    st._setupError = null;
    st._busy = true;
    renderPreview();
    showStatus(STATUS_OK);
    setButtonsDisabled(true);
    let result;
    try {
        result = await applySetup(st);
    } catch (err) {
        result = { applied: false, error: String((err && err.message) || err) };
    }
    running = false;
    if (!overlayEl || !st) return; // cerrado a mitad (Escape): nada más que tocar
    st._busy = false;
    if (result && result.applied) {
        notifyCompleted();
        navNext(st);
        saveProgress(localStorage, st);
        renderPreview();
        return;
    }
    st._setupError = (result && result.error) || 'No se pudo guardar la configuración.';
    renderPreview();
}

function renderPreview() {
    if (!overlayEl || !st) return;
    overlayEl.innerHTML = renderOnboarding(st, buildChrome());
}

function onOverlayClick(e) {
    if (!overlayEl || !st) return;
    const el = e.target.closest('[data-act]');
    if (!el || !overlayEl.contains(el)) return;
    const act = el.dataset.act;
    if (act === 'closePreview') { closeOnboardingPreview(); return; }
    /* "Saltar por ahora": completa sin elegir origen y cierra; en modo live el
     * cierre devuelve a la app normal. Limpia el progreso a mitad para que una
     * relanzación manual empiece de nuevo desde la bienvenida. */
    if (act === 'skipOnboarding') {
        clearProgress(localStorage);
        notifyCompleted(localStorage);
        closeOnboardingPreview();
        return;
    }
    /* En fase 'listo', "Entrar a la app" cierra el arnés (el core ya limpió storage). */
    if (act === 'next' && st.phase === 'ready') { closeOnboardingPreview(); return; }
    /* Opciones de elección: acción REAL asíncrona (deps por defecto), no solo pick(). */
    if (act === 'pick' && CHOICE_SOURCES.includes(el.dataset.v)) { runChoice(el.dataset.v); return; }
    /* Último paso del setup ("Finalizar"): commit real antes de pasar a 'listo'. */
    if (act === 'next' && st.phase === 'setup' && st.setupStep === SETUP_TOTAL) { runFinish(); return; }
    handleAction(act, el, st);
    saveProgress(localStorage, st);
    renderPreview();
}

function onOverlayInput(e) {
    if (!overlayEl || !st) return;
    const el = e.target.closest('input[data-field]');
    if (!el || !overlayEl.contains(el)) return;
    handleAction('input', el, st);
    saveProgress(localStorage, st);
    renderPreview();
}

/* Teclado del diálogo: Escape cierra, Tab cicla dentro del overlay y las flechas
 * navegan la guía solo cuando el foco no está en un control interactivo. */
function onOverlayKeydown(e) {
    if (!overlayEl || !st) return;
    if (e.key === 'Escape') { closeOnboardingPreview(); return; }
    if (e.key === 'Tab') { trapTabKey(e, overlayEl); return; }
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON') return;
    if ((e.key === 'ArrowRight' || e.key === 'ArrowDown') && canAdvance(st)) {
        navNext(st);
        saveProgress(localStorage, st);
        renderPreview();
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        navBack(st);
        saveProgress(localStorage, st);
        renderPreview();
    }
}

function mountOverlay() {
    overlayEl = document.createElement('div');
    overlayEl.id = 'onboarding-preview-overlay';
    overlayEl.setAttribute('role', 'dialog');
    overlayEl.setAttribute('aria-modal', 'true');
    overlayEl.setAttribute('aria-label', 'Configuración inicial de la aplicación');
    overlayEl.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(2,6,23,.86);overflow:auto;';
    document.body.appendChild(overlayEl);
    prevFocus = document.activeElement;
    overlayEl.addEventListener('click', onOverlayClick);
    overlayEl.addEventListener('input', onOverlayInput);
    escHandler = onOverlayKeydown;
    document.addEventListener('keydown', escHandler);
}

function unmountOverlay() {
    if (!overlayEl) return;
    running = false;
    overlayEl.removeEventListener('click', onOverlayClick);
    overlayEl.removeEventListener('input', onOverlayInput);
    overlayEl.remove();
    overlayEl = null;
    if (escHandler) {
        document.removeEventListener('keydown', escHandler);
        escHandler = null;
    }
}

function focusInitial() {
    const first = overlayEl && getOverlayFocusable(overlayEl)[0];
    if (first) first.focus();
}

export function showOnboardingPreview({ mode = 'preview' } = {}) {
    if (overlayEl) { renderPreview(); return; }
    hostMode = mode === 'live' ? 'live' : 'preview';
    completedSnapshot = readCompletedFlag();
    justCompleted = false;
    st = restoreProgress(localStorage, defaultState());
    mountOverlay();
    renderPreview();
    focusInitial();
}

/* Arranque real desde app.js: mismo arnés, sin badge de vista previa. */
export const launchOnboardingV2 = showOnboardingPreview;

/* Cerrar a mitad de flujo conserva 'onboarding-pos': reabrir retoma desde ahí.
 * El flag 'onboardingCompleted' solo sobrevive al cierre si la sesión recién
 * completó el flujo (notifyCompleted); si no, se restaura el snapshot previo. */
export function closeOnboardingPreview() {
    const wasOpen = !!overlayEl;
    const finished = justCompleted;
    const back = prevFocus && typeof prevFocus.focus === 'function' ? prevFocus : null;
    unmountOverlay();
    prevFocus = null;
    st = null;
    if (wasOpen) {
        if (!finished) restoreCompletedFlag();
        justCompleted = false;
    }
    if (back && back.isConnected) back.focus();
}

export function resetOnboardingPreview() {
    clearProgress(localStorage);
    if (overlayEl) { st = defaultState(); renderPreview(); return; }
    showOnboardingPreview();
}

window.showOnboardingPreview = showOnboardingPreview;
window.closeOnboardingPreview = closeOnboardingPreview;
window.resetOnboardingPreview = resetOnboardingPreview;
window.launchOnboardingV2 = launchOnboardingV2;
