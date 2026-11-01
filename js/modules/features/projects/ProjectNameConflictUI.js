import { getProjectNameConflicts, resolveProjectNameConflict, PROJECT_NAME_CONFLICT_EVENT } from './ProjectNameConflicts.js';
import { firstAvailableProjectName, projectNameKey } from './ProjectNames.js';
import { attachProjectDialogA11y } from './ProjectDialogA11y.js';
import { indexedDBService } from '../../services/IndexedDBService.js';
import { isProjectsEnabled } from '../../config/FeatureFlags.js';

const ID = 'project-name-conflict-modal';
let opening = null;
let lastPrompted = '';
let appReady = false;
const fingerprint = rows => rows.map(row => `${row.id}:${JSON.stringify(row.metadata.nameConflict)}`).sort().join('|');
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

export async function openProjectNameConflicts({ idb = indexedDBService } = {}) {
    if (opening) return opening;
    if (document.getElementById(ID)) return;
    opening = mount(idb);
    try { return await opening; } finally { opening = null; }
}

async function mount(idb) {
    let pending = await getProjectNameConflicts({ idb });
    if (!pending.length) return;
    lastPrompted = fingerprint(pending);
    const previousFocus = document.activeElement;
    const overlay = document.createElement('div');
    overlay.id = ID;
    overlay.className = 'project-shell-overlay';
    overlay.style.zIndex = '10080';
    let busy = false;
    let detach;
    const close = () => {
        if (busy) return;
        detach?.({ restoreFocus: false });
        overlay.remove();
        if (previousFocus?.isConnected) previousFocus.focus?.();
    };
    const render = async () => {
        pending = await getProjectNameConflicts({ idb });
        if (!pending.length) { close(); return; }
        const current = pending[0];
        const conflict = current.metadata.nameConflict;
        const projects = await idb.getAll('projects');
        const other = projects.find(row => row.id !== current.id && projectNameKey(row.name) === projectNameKey(conflict.requestedName));
        const suggestion = firstAvailableProjectName(String(conflict.requestedName).slice(0, 70), projects);
        overlay.innerHTML = `<section class="project-shell is-compact" role="dialog" aria-modal="true" aria-labelledby="project-name-conflict-title">
            <header class="project-shell-header">
                <div class="project-shell-heading"><div class="project-kicker">Nombre repetido · ${pending.length} pendiente${pending.length === 1 ? '' : 's'}</div><h2 id="project-name-conflict-title" class="project-shell-title">Distingue tus obras</h2><div class="project-shell-subtitle">Pon un nombre distinto a cada obra.</div></div>
                <button type="button" class="project-icon-btn" data-conflict-close aria-label="Resolver más tarde"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
            </header>
            <form class="project-shell-body" data-conflict-form>
                <div class="project-notice"><div class="project-kicker">Ya existe</div><strong>${esc(other?.name || conflict.requestedName)}</strong></div>
                <div class="project-notice is-warning" style="margin-top:12px"><div class="project-kicker">${conflict.source === 'cloud' ? 'Recibida de la nube' : conflict.source === 'backup' ? 'Recuperada del respaldo' : 'Pendiente de distinguir'}</div><strong>${esc(conflict.requestedName)}</strong><div class="project-help">Sus empleados, asistencia y préstamos se conservan.</div><details class="project-tech-details"><summary>Identificar obra</summary><code>${esc(current.id)}</code>${other ? `<br><code>${esc(other.id)}</code>` : ''}</details></div>
                <div class="project-field"><label for="project-conflict-name">Nombre de esta obra</label><input id="project-conflict-name" maxlength="80" required autocomplete="off" value="${esc(suggestion)}"></div>
                <div class="project-status-line is-error" role="alert" data-conflict-error></div>
                <button type="button" class="project-action is-secondary" data-conflict-refresh hidden style="display:none">Volver a revisar</button>
                <div class="project-actions" style="justify-content:flex-end;margin-top:20px"><button type="button" class="project-action is-secondary" data-conflict-close>Más tarde</button><button type="submit" class="project-action is-primary">Guardar nombre</button></div>
            </form>
        </section>`;
        overlay.querySelectorAll('[data-conflict-close]').forEach(button => button.addEventListener('click', close));
        overlay.querySelector('[data-conflict-refresh]').addEventListener('click', () => render().catch(error => {
            overlay.querySelector('[data-conflict-error]').textContent = error.message;
        }));
        overlay.querySelector('form').addEventListener('submit', async event => {
            event.preventDefault();
            if (busy) return;
            busy = true;
            const buttons = overlay.querySelectorAll('button');
            buttons.forEach(button => { button.disabled = true; });
            try {
                await resolveProjectNameConflict(current.id, overlay.querySelector('input').value, { idb, expectedConflict: conflict });
                window.dispatchEvent(new CustomEvent('projects:setup-changed', { detail: { projectId: current.id, renamed: true } }));
                window.render?.();
                busy = false;
                await render();
            } catch (error) {
                overlay.querySelector('[data-conflict-error]').textContent = error.message || String(error);
                overlay.querySelector('[data-conflict-refresh]').hidden = false;
                overlay.querySelector('[data-conflict-refresh]').style.display = '';
            } finally {
                busy = false;
                buttons.forEach(button => { button.disabled = false; });
            }
        });
        detach?.({ restoreFocus: false });
        detach = attachProjectDialogA11y(overlay, { onEscape: close });
    };
    document.body.appendChild(overlay);
    try { await render(); } catch (error) { close(); throw error; }
    return overlay;
}

// No interrumpir otro formulario. El pendiente queda guardado y se puede
// retomar desde Ajustes → Proyectos o desde la tarjeta de la obra.
if (typeof window !== 'undefined') {
    const reviewPending = async () => {
        if (!appReady || !isProjectsEnabled() || document.querySelector('[role="dialog"]')) return;
        try {
            const rows = await getProjectNameConflicts();
            if (!rows.length || fingerprint(rows) === lastPrompted || document.querySelector('[role="dialog"]')) return;
            await openProjectNameConflicts();
        } catch (error) { console.warn('No se pudo abrir la revisión de nombres:', error.message); }
    };
    window.addEventListener(PROJECT_NAME_CONFLICT_EVENT, reviewPending);
    // app:ready ocurre después de abrir el onboarding si corresponde.
    // Evita superponer el resolutor a la restauración/arranque inicial.
    window.addEventListener('app:ready', () => { appReady = true; void reviewPending(); });
}
