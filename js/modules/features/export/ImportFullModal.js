/**
 * FULL import wizard shell.
 *
 * design.md continuity contract:
 * - one overlay/shell for paste -> confirmation -> reconciliation;
 * - stage changes morph the existing shell instead of closing/reopening;
 * - inline guidance, no native alert/confirm;
 * - accessible labels, focus visibility and >=44px actions.
 *
 * Legacy unit tests may still exercise ExportController without mounting this
 * view; ExportController retains its historical showConfirm fallback there.
 */

import { state } from '../../core/AppState.js';
import { escapeHTML } from '../../utils/Sanitize.js';
import icons from '../../ui/IconSystem.js';

let stage = 'paste';
let confirmContext = { employeesCount: 0 };
let embeddedContext = null;
let morphTimer = null;
let a11yRegistered = false;

function header(title, subtitle) {
    return `
        <div class="import-full-topbar">
            <div class="import-full-heading">
                <span class="import-full-kicker">IMPORTACIÓN FULL</span>
                <h2 id="import-full-title">${escapeHTML(title)}</h2>
                <p>${escapeHTML(subtitle)}</p>
            </div>
            <button type="button" class="import-full-close" data-app-fn="closeImportFullModal" aria-label="Cerrar importación">
                ${icons.get('close')}
            </button>
        </div>
    `;
}

function pasteStage() {
    return `
        ${header('Importar datos FULL', 'Pega el JSON generado en Compartir FULL.')}
        <div class="import-full-stage-body">
            <label for="import-full-textarea" class="import-full-label">Datos FULL en formato JSON</label>
            <textarea id="import-full-textarea"
                data-import-full-input
                placeholder="{ ... }"
                autocomplete="off"
                spellcheck="false">${escapeHTML(state.importFullText || '')}</textarea>
        </div>
        <div class="import-full-footer">
            <button type="button" class="btn-secondary import-full-footer-btn" data-app-fn="closeImportFullModal">Cancelar</button>
            <div class="import-full-footer-hint">El respaldo se valida antes de reemplazar datos.</div>
            <button type="button" class="btn-primary import-full-footer-btn" data-app-fn="confirmImportFull">Revisar importación</button>
        </div>
    `;
}

function confirmStage() {
    const count = Math.max(0, Number(confirmContext.employeesCount) || 0);
    return `
        ${header('Reemplazar datos', 'Confirma el alcance antes de aplicar el respaldo.')}
        <div class="import-full-stage-body">
            <div class="import-full-confirm-summary" aria-live="polite">
                <strong>${count}</strong>
                <span>${count === 1 ? 'empleado en el respaldo' : 'empleados en el respaldo'}</span>
            </div>
            <div class="import-full-inline-warning" role="status">
                <strong>Se reemplazarán los datos actuales de SA.</strong>
                <span>Si el respaldo necesita una decisión de obra, SA la pedirá antes de guardar cualquier cambio.</span>
            </div>
        </div>
        <div class="import-full-footer">
            <button type="button" class="btn-secondary import-full-footer-btn" data-app-fn="backToImportFullPaste">Volver</button>
            <div class="import-full-footer-hint">Nada se modifica hasta completar la validación.</div>
            <button type="button" class="btn-primary import-full-footer-btn" data-app-fn="applyConfirmedFullImport">Importar ahora</button>
        </div>
    `;
}

function embeddedStage() {
    const ctx = embeddedContext || {};
    return `
        ${header(ctx.title || 'Reconciliación de importación', ctx.subtitle || 'Revisa los datos antes de continuar.')}
        <div class="import-full-stage-body import-full-embedded-body">
            ${ctx.content || ''}
        </div>
    `;
}

function renderInner() {
    if (stage === 'confirm') return confirmStage();
    if (stage === 'reconcile') return embeddedStage();
    return pasteStage();
}

function focusForStage(shell) {
    if (!shell) return;
    let target = null;
    if (stage === 'paste') target = shell.querySelector('#import-full-textarea');
    else if (stage === 'confirm') target = shell.querySelector('[data-app-fn="applyConfirmedFullImport"]');
    else target = shell.querySelector('input[name="r07-import-project"]:checked')
        || shell.querySelector('input[name="r07-import-project"]')
        || shell.querySelector('select:not([disabled]), button:not([disabled])');
    target?.focus?.();
}

function morphVisibleShell() {
    if (typeof document === 'undefined') return false;
    const shell = document.querySelector('.import-full-dialog');
    if (!shell) return false;

    const oldHeight = shell.getBoundingClientRect().height;
    const reducedMotion = typeof window !== 'undefined'
        && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;

    shell.innerHTML = renderInner();
    shell.setAttribute('aria-labelledby', 'import-full-title');
    const targetHeight = shell.getBoundingClientRect().height;

    if (!reducedMotion && oldHeight > 0 && targetHeight > 0 && Math.abs(targetHeight - oldHeight) > 2) {
        clearTimeout(morphTimer);
        shell.style.height = oldHeight + 'px';
        shell.style.overflow = 'hidden';
        shell.style.transition = 'height 260ms cubic-bezier(.2,.8,.2,1)';
        shell.getBoundingClientRect();
        requestAnimationFrame(() => {
            shell.style.height = targetHeight + 'px';
        });
        morphTimer = setTimeout(() => {
            shell.style.height = '';
            shell.style.overflow = '';
            shell.style.transition = '';
        }, 280);
    }

    requestAnimationFrame(() => focusForStage(shell));
    return true;
}


export function ensureImportFullAccessibilityHandlers() {
    if (a11yRegistered || typeof document === 'undefined') return;
    a11yRegistered = true;
    document.addEventListener('keydown', (event) => {
        const shell = document.querySelector('.import-full-dialog');
        if (!shell) return;

        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            if (stage === 'confirm') {
                window.backToImportFullPaste?.();
            } else {
                window.closeImportFullModal?.();
            }
            return;
        }
        if (event.key !== 'Tab') return;

        const selector = 'button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
        const focusables = [...shell.querySelectorAll(selector)].filter(el => el.offsetParent !== null);
        if (!focusables.length) {
            event.preventDefault();
            shell.focus?.();
            return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        } else if (!shell.contains(document.activeElement)) {
            event.preventDefault();
            first.focus();
        }
    }, true);
}

export function resetImportFullModalStage() {
    stage = 'paste';
    confirmContext = { employeesCount: 0 };
    embeddedContext = null;
}

export function showImportFullPasteStage() {
    stage = 'paste';
    confirmContext = { employeesCount: 0 };
    embeddedContext = null;
    morphVisibleShell();
}

export function showImportFullConfirmStage({ employeesCount = 0 } = {}) {
    stage = 'confirm';
    confirmContext = { employeesCount };
    embeddedContext = null;
    return morphVisibleShell();
}

export function showImportFullEmbeddedStage({ title, subtitle, content } = {}) {
    stage = 'reconcile';
    embeddedContext = { title, subtitle, content: content || '' };
    return morphVisibleShell();
}

export function updateImportFullEmbeddedContent(content) {
    if (stage !== 'reconcile') return false;
    embeddedContext = { ...(embeddedContext || {}), content: content || '' };
    return morphVisibleShell();
}

export function isImportFullEmbeddedStageActive() {
    return stage === 'reconcile'
        && typeof document !== 'undefined'
        && !!document.querySelector('.import-full-dialog');
}

export function getImportFullModalStage() {
    return stage;
}

export function ImportFullModal() {
    if (!state.showImportFullModal) return '';
    return `
        <div class="modal-overlay import-full-overlay"
             data-app-close-on-self="close-import-full"
             role="presentation">
            <div class="import-full-dialog"
                 role="dialog"
                 aria-modal="true"
                 aria-labelledby="import-full-title"
                 data-app-stop-only="1">
                ${renderInner()}
            </div>
        </div>
    `;
}
