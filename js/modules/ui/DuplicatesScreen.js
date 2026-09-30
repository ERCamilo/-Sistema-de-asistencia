/**
 * 🧩 DuplicatesScreen — pantalla única «Duplicados».
 *
 * Reemplaza al asistente de saneamiento (plan → uno por uno → reasignación)
 * por una sola pantalla con el lenguaje de design.md:
 *   Lista  → cada grupo es una fila; los seguros se unen con un botón.
 *   Grupo  → una tarjeta por registro con cuatro decisiones directas:
 *            Conservar · Unir · Otra persona · Eliminar.
 *   Listo  → resumen con lo que realmente se aplicó.
 * Mismo shell en los tres pasos (morph, sin cerrar y reabrir modales).
 *
 * La lógica vive en DuplicateGroups (qué es un grupo, validación) y en
 * EmployeeDuplicateService (cómo se aplica); aquí solo hay presentación.
 */
import { state } from '../core/AppState.js';
import { escapeHTML } from '../utils/Sanitize.js';
import {
    buildDuplicateGroups, planGroupDecisions, suggestFreeNumber, DUPLICATE_ROLES
} from '../features/employees/DuplicateGroups.js';

const DISMISSED_KEY = 'asistencia_duplicates_dismissed_v1';

const ICON = {
    people: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.2"/><path d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5"/><circle cx="16.5" cy="9" r="2.6"/><path d="M15.5 14.2c2.4.1 4.3 1.7 4.9 4.8"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
    next: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7"/></svg>'
};

const ROLE_BUTTONS = [
    { role: DUPLICATE_ROLES.KEEP, label: 'Conservar', help: 'perfil principal' },
    { role: DUPLICATE_ROLES.MERGE, label: 'Unir', help: 'misma persona' },
    { role: DUPLICATE_ROLES.OTHER, label: 'Otra persona', help: 'se queda aparte' },
    { role: DUPLICATE_ROLES.DELETE, label: 'Eliminar', help: 'registro de más' }
];

const REASON_LABEL = { number: 'Misma ficha', name: 'Mismo nombre', both: 'Misma ficha y nombre' };
const SOURCE_LABEL = { local: 'Este dispositivo', cloud: 'Solo en la nube', both: 'Dispositivo y nube' };

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const initials = name => escapeHTML(String(name || '?').trim().split(/\s+/).map(part => part[0] || '').join('').slice(0, 2).toUpperCase());
const formatDate = value => {
    if (!value) return 'Nunca';
    const [y, m, d] = String(value).split('-');
    return d && m && y ? `${d}/${m}/${y.slice(2)}` : escapeHTML(value);
};

function readDismissed() {
    try { return new Set(JSON.parse(globalThis.localStorage?.getItem(DISMISSED_KEY) || '[]')); }
    catch { return new Set(); }
}
function writeDismissed(set) {
    try { globalThis.localStorage?.setItem(DISMISSED_KEY, JSON.stringify([...set])); } catch { /* noop */ }
}

/** Propuesta inicial de un grupo con la ficha nueva sugerida para «otra persona». */
function withNumberSuggestions(group, decisions, context) {
    const next = { ...decisions };
    const reserved = [];
    for (const member of group.members) {
        const decision = next[member.id];
        if (decision?.role !== DUPLICATE_ROLES.OTHER || decision.number !== undefined) continue;
        const clashes = group.members.some(other => other.id !== member.id
            && [DUPLICATE_ROLES.KEEP, DUPLICATE_ROLES.OTHER].includes(next[other.id]?.role)
            && other.projectId === member.projectId
            && String(other.number) === String(member.number));
        if (!clashes) continue;
        const number = suggestFreeNumber(context.employees, member.projectId, context.defaultProjectId, reserved);
        reserved.push(number);
        next[member.id] = { ...decision, number };
    }
    return next;
}

// ───────────────────────────── render (puro) ─────────────────────────────

function renderHeader(view) {
    const subtitle = view.step === 'group' ? 'Revisa un grupo' : view.step === 'done' ? 'Todo en orden' : 'Una persona, una ficha';
    return `
        <header class="dup-header">
            <div class="dup-identity">${ICON.people}</div>
            <div class="dup-heading">
                <h2 class="dup-title" id="dup-title">Duplicados</h2>
                <div class="dup-subtitle">${subtitle}</div>
            </div>
            <button type="button" class="dup-icon-btn" data-dup-action="close" aria-label="Cerrar">${ICON.close}</button>
        </header>`;
}

function memberChips(member, { showProject }) {
    const chips = [`<span class="dup-chip is-mono">Ficha ${escapeHTML(member.number || '—')}</span>`];
    if (showProject && member.projectName) chips.push(`<span class="dup-chip">${escapeHTML(member.projectName)}</span>`);
    if (member.source === 'cloud') chips.push('<span class="dup-chip is-info">Solo en la nube</span>');
    return chips.join('');
}

function renderGroupRow(group, resolved) {
    const names = [...new Set(group.members.map(m => m.name || '(sin nombre)'))];
    const numbers = [...new Set(group.members.map(m => m.number || '—'))];
    const status = resolved
        ? `<span class="dup-row-check" aria-label="Resuelto">${ICON.check}</span>`
        : group.safe
            ? '<span class="dup-status is-good">Seguro</span>'
            : '<span class="dup-status is-warn">Revisar</span>';
    return `
        <button type="button" class="dup-row ${resolved ? 'is-resolved' : ''}" data-dup-action="open-group" data-id="${escapeHTML(group.id)}"
                ${resolved ? 'disabled aria-disabled="true"' : ''}>
            <span class="dup-row-number">${numbers.map(escapeHTML).join(' · ')}</span>
            <span class="dup-row-main">
                <strong>${names.map(escapeHTML).join(' / ')}</strong>
                <small>${escapeHTML(REASON_LABEL[group.reason])} · ${plural(group.members.length, 'registro', 'registros')}${group.members.some(m => m.source === 'cloud') ? ' · incluye nube' : ''}</small>
            </span>
            ${status}
            ${resolved ? '' : `<span class="dup-row-chevron">${ICON.next}</span>`}
        </button>`;
}

function renderList(view) {
    const pending = view.groups.filter(g => !view.resolved[g.id]);
    const safe = pending.filter(g => g.safe);
    const review = pending.filter(g => !g.safe);
    const notice = view.cloudFailed
        ? '<div class="dup-notice is-warn"><strong>No se pudo leer la nube</strong><p>Se muestran solo los datos de este dispositivo.</p></div>'
        : '';
    const error = view.error ? `<div class="dup-notice is-bad"><strong>${escapeHTML(view.error)}</strong></div>` : '';
    return `
        <div class="dup-body">
            <span class="dup-kicker">DUPLICADOS</span>
            <h1 class="dup-h1">Una persona, una ficha</h1>
            <p class="dup-lead">Une las copias con su asistencia y préstamos, y deja cada ficha con su dueño.</p>
            ${notice}${error}
            <div class="dup-summary">
                <div class="dup-summary-tile is-good">
                    <span class="dup-metric">${safe.length}</span>
                    <span>${safe.length === 1 ? 'listo para unir' : 'listos para unir'}</span>
                </div>
                <div class="dup-summary-tile is-warn">
                    <span class="dup-metric">${review.length}</span>
                    <span>para revisar</span>
                </div>
            </div>
            <div class="dup-list" role="list">
                ${view.groups.map(group => renderGroupRow(group, view.resolved[group.id])).join('')}
            </div>
            <details class="dup-advanced">
                <summary>Opciones avanzadas</summary>
                <button type="button" class="dup-btn is-quiet" data-dup-action="cloud-reconcile">Limpiar en la nube los empleados que ya no existen aquí</button>
            </details>
        </div>`;
}

function renderMemberCard(member, decision, group, view) {
    const role = decision?.role || null;
    const needsNumber = role === DUPLICATE_ROLES.OTHER && decision?.number != null;
    const deleteWarning = role === DUPLICATE_ROLES.DELETE
        ? member.hasOpenBalance
            ? '<div class="dup-inline is-bad">Tiene préstamos con saldo. Únelo al principal en vez de eliminarlo.</div>'
            : (member.attendanceCount || member.loansCount)
                ? `<div class="dup-inline is-bad">Se borran ${[
                    member.attendanceCount ? plural(member.attendanceCount, 'asistencia', 'asistencias') : '',
                    member.loansCount ? plural(member.loansCount, 'préstamo', 'préstamos') : ''
                ].filter(Boolean).join(' y ')}. Para conservarlos, elige Unir.</div>`
                : ''
        : '';
    const numberField = needsNumber ? `
        <label class="dup-number-field">
            <span>Ficha nueva</span>
            <input type="text" inputmode="numeric" autocomplete="off" maxlength="10"
                   class="dup-number-input" data-dup-number="${escapeHTML(member.id)}" value="${escapeHTML(decision.number)}">
        </label>` : '';
    const keeper = group.members.find(m => view.decisions[m.id]?.role === DUPLICATE_ROLES.KEEP);
    const mergeNote = role === DUPLICATE_ROLES.MERGE && keeper
        ? `<div class="dup-inline">Su asistencia y préstamos pasan a ${escapeHTML(keeper.name)} (ficha ${escapeHTML(keeper.number)}).</div>`
        : '';
    return `
        <article class="dup-card ${role ? `is-${role}` : ''}" data-member="${escapeHTML(member.id)}">
            <div class="dup-card-head">
                <span class="dup-avatar">${initials(member.name)}</span>
                <div class="dup-card-name">
                    <strong>${escapeHTML(member.name || '(sin nombre)')}</strong>
                    <div class="dup-chips">${memberChips(member, { showProject: view.multiProject })}</div>
                </div>
            </div>
            <dl class="dup-stats">
                <div><dt>Asistencias</dt><dd>${member.attendanceCount}</dd></div>
                <div><dt>Última</dt><dd>${formatDate(member.lastAttendance)}</dd></div>
                <div><dt>Préstamos</dt><dd>${member.loansCount}</dd></div>
            </dl>
            <div class="dup-roles" role="radiogroup" aria-label="Qué hacer con ${escapeHTML(member.name)}">
                ${ROLE_BUTTONS.map(button => `
                    <button type="button" role="radio" class="dup-role is-${button.role} ${role === button.role ? 'is-selected' : ''}"
                            aria-checked="${role === button.role}" data-dup-action="set-role"
                            data-id="${escapeHTML(member.id)}" data-role="${button.role}">
                        <span>${button.label}</span><small>${button.help}</small>
                    </button>`).join('')}
            </div>
            ${numberField}${mergeNote}${deleteWarning}
        </article>`;
}

function renderGroup(view) {
    const group = view.groups.find(g => g.id === view.groupId);
    if (!group) return renderList(view);
    const numbers = [...new Set(group.members.map(m => m.number))];
    const kicker = group.reason === 'name' ? 'MISMO NOMBRE' : `FICHA ${numbers.join(' · ')}`;
    const error = view.error ? `<div class="dup-notice is-bad"><strong>${escapeHTML(view.error)}</strong></div>` : '';
    return `
        <div class="dup-body">
            <span class="dup-kicker">${escapeHTML(kicker)}</span>
            <h1 class="dup-h1">¿Son la misma persona?</h1>
            <p class="dup-lead">Conserva un perfil y une las copias; si alguien es otra persona, déjalo aparte.</p>
            ${error}
            <div class="dup-cards is-${Math.min(group.members.length, 3)}">
                ${group.members.map(member => renderMemberCard(member, view.decisions[member.id], group, view)).join('')}
            </div>
            ${group.reason === 'name' ? '<button type="button" class="dup-btn is-quiet" data-dup-action="dismiss-group">No son duplicados, no volver a mostrar</button>' : ''}
        </div>`;
}

function renderDone(view) {
    const t = view.totals;
    const rows = [
        [t.merged, 'unidos a su perfil principal'],
        [t.renumbered, 'con ficha nueva'],
        [t.deleted, 'eliminados'],
        [t.dismissed, 'marcados como personas distintas']
    ].filter(([n]) => n > 0);
    return `
        <div class="dup-body dup-done">
            <span class="dup-done-check">${ICON.check}</span>
            <span class="dup-kicker">LISTO</span>
            <h1 class="dup-h1">${view.groups.length ? 'Duplicados resueltos' : 'No hay duplicados'}</h1>
            <p class="dup-lead">${view.groups.length ? 'Los cambios se guardaron y se envían a tus otros dispositivos.' : 'Cada ficha tiene un solo dueño.'}</p>
            ${rows.length ? `<ul class="dup-done-list">${rows.map(([n, label]) => `<li><span class="dup-metric is-small">${n}</span>${label}</li>`).join('')}</ul>` : ''}
        </div>`;
}

function renderFooter(view) {
    if (view.step === 'group') {
        const plan = view.plan;
        const deletes = plan?.ok ? plan.deleteIds.length : 0;
        const label = deletes ? `Aplicar y eliminar ${deletes}` : 'Aplicar';
        return `
            <footer class="dup-footer">
                <button type="button" class="dup-btn is-back" data-dup-action="back">${ICON.back}<span>Volver</span></button>
                <span class="dup-hint">${plan?.ok ? '' : escapeHTML(plan?.hint || '')}</span>
                <button type="button" class="dup-btn is-primary ${deletes ? 'is-danger' : ''}" data-dup-action="apply-group"
                        ${plan?.ok && !view.busy ? '' : 'disabled aria-disabled="true"'}>${view.busy ? 'Guardando…' : label}${ICON.check}</button>
            </footer>`;
    }
    if (view.step === 'done' || view.step === 'loading') {
        return `
            <footer class="dup-footer">
                <span></span><span class="dup-hint">${view.step === 'loading' ? 'Buscando en este dispositivo y en la nube…' : ''}</span>
                <button type="button" class="dup-btn is-primary" data-dup-action="close" ${view.step === 'loading' ? 'disabled' : ''}>Listo${ICON.check}</button>
            </footer>`;
    }
    const pending = view.groups.filter(g => !view.resolved[g.id]);
    const safe = pending.filter(g => g.safe).length;
    const primary = safe
        ? `<button type="button" class="dup-btn is-primary" data-dup-action="merge-safe" ${view.busy ? 'disabled' : ''}>${view.busy ? 'Guardando…' : `Unir ${safe} ${safe === 1 ? 'seguro' : 'seguros'}`}${ICON.check}</button>`
        : pending.length
            ? `<button type="button" class="dup-btn is-primary" data-dup-action="open-next">Revisar${ICON.next}</button>`
            : `<button type="button" class="dup-btn is-primary" data-dup-action="finish">Terminar${ICON.check}</button>`;
    return `
        <footer class="dup-footer">
            <button type="button" class="dup-btn is-back" data-dup-action="close"><span>Cerrar</span></button>
            <span class="dup-hint">${safe ? 'Mismo nombre y ficha: se unen conservando todo' : ''}</span>
            ${primary}
        </footer>`;
}

/** HTML interior del shell para un estado de vista (usado también por la maqueta). */
export function renderDuplicatesView(view) {
    const body = view.step === 'loading'
        ? '<div class="dup-body"><span class="dup-kicker">DUPLICADOS</span><h1 class="dup-h1">Buscando duplicados…</h1><div class="dup-skeleton"></div><div class="dup-skeleton"></div></div>'
        : view.step === 'group' ? renderGroup(view)
            : view.step === 'done' ? renderDone(view)
                : renderList(view);
    return `${renderHeader(view)}<div class="dup-scroll">${body}</div>${renderFooter(view)}`;
}

// ───────────────────────────── controlador ─────────────────────────────

function prefersReducedMotion() {
    try { return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true; } catch { return false; }
}

/** Mismo shell, contenido nuevo, con transición de tamaño (design.md §4.4). */
function morph(shell, render, animate) {
    if (!animate || prefersReducedMotion() || typeof shell.animate !== 'function') { render(); return; }
    const from = shell.getBoundingClientRect();
    render();
    const to = shell.getBoundingClientRect();
    if (Math.abs(from.height - to.height) < 2 && Math.abs(from.width - to.width) < 2) return;
    shell.animate([{ height: `${from.height}px`, width: `${from.width}px` }, { height: `${to.height}px`, width: `${to.width}px` }],
        { duration: 260, easing: 'cubic-bezier(.2,.8,.2,1)' });
    shell.querySelector('.dup-body')?.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }],
        { duration: 180, easing: 'ease-out' });
}

export class DuplicatesScreen {
    constructor(deps = {}) {
        this.deps = deps;
        this.view = { step: 'loading', groups: [], resolved: {}, decisions: {}, totals: { merged: 0, renumbered: 0, deleted: 0, dismissed: 0 } };
        this.overlay = null;
        this.snapshotTaken = false;
        this.onClick = this.onClick.bind(this);
        this.onInput = this.onInput.bind(this);
        this.onKeydown = this.onKeydown.bind(this);
    }

    async open() {
        this.mount();
        this.render(false);
        await this.scan();
        this.view.step = this.view.groups.length ? 'list' : 'done';
        this.render(true);
        return this;
    }

    mount() {
        const doc = globalThis.document;
        this.overlay = doc.createElement('div');
        this.overlay.className = 'dup-overlay';
        this.overlay.innerHTML = '<section class="dup-shell" role="dialog" aria-modal="true" aria-labelledby="dup-title"></section>';
        this.shell = this.overlay.firstElementChild;
        this.overlay.addEventListener('click', this.onClick);
        this.overlay.addEventListener('input', this.onInput);
        doc.addEventListener('keydown', this.onKeydown);
        doc.body.appendChild(this.overlay);
    }

    close() {
        globalThis.document?.removeEventListener('keydown', this.onKeydown);
        this.overlay?.remove();
        this.overlay = null;
        if (this.changed) globalThis.render?.();
    }

    async context() {
        const deps = this.deps;
        const scope = deps.peekScope?.() || {};
        let projectNames = {};
        try {
            const projects = await deps.listProjects?.() || [];
            projectNames = Object.fromEntries(projects.map(project => [String(project.id), project.name || '']));
        } catch { /* sin nombres de obra */ }
        return {
            employees: state.employees || [],
            attendance: state.attendance || {},
            defaultProjectId: scope.enabled ? scope.defaultProjectId || null : null,
            projectNames
        };
    }

    async scan() {
        const deps = this.deps;
        let cloudEmployees = [];
        this.view.cloudFailed = false;
        if (deps.canReadCloud?.()) {
            try {
                const loaded = await deps.loadCloudEmployees();
                if (loaded === null) this.view.cloudFailed = true;
                else cloudEmployees = (loaded || []).filter(record => !deps.isMergedAway?.(record?.id));
            } catch { this.view.cloudFailed = true; }
        }
        const ctx = await this.context();
        this.ctx = ctx;
        this.view.groups = buildDuplicateGroups({ ...ctx, cloudEmployees, dismissed: readDismissed() });
        this.view.multiProject = new Set(this.view.groups.flatMap(g => g.members.map(m => m.projectId))).size > 1;
    }

    render(animate = false) {
        if (!this.shell) return;
        if (this.view.step === 'group') {
            const group = this.view.groups.find(g => g.id === this.view.groupId);
            this.view.plan = group ? planGroupDecisions(group, this.view.decisions, this.ctx) : null;
        }
        const focusedNumber = globalThis.document?.activeElement?.dataset?.dupNumber;
        const caret = focusedNumber ? globalThis.document.activeElement.selectionStart : null;
        morph(this.shell, () => { this.shell.innerHTML = renderDuplicatesView(this.view); }, animate);
        this.shell.classList.toggle('is-wide', this.view.step === 'group');
        if (focusedNumber) {
            const input = [...this.shell.querySelectorAll('[data-dup-number]')].find(el => el.dataset.dupNumber === focusedNumber);
            input?.focus();
            if (caret != null) input?.setSelectionRange?.(caret, caret);
        }
    }

    openGroup(id) {
        const group = this.view.groups.find(g => g.id === id);
        if (!group) return;
        this.view.step = 'group';
        this.view.groupId = id;
        this.view.error = '';
        this.view.decisions = withNumberSuggestions(group, { ...group.decisions }, this.ctx);
        this.render(true);
        this.shell.querySelector('.dup-scroll')?.scrollTo?.(0, 0);
    }

    setRole(memberId, role) {
        const group = this.view.groups.find(g => g.id === this.view.groupId);
        if (!group) return;
        const decisions = { ...this.view.decisions };
        if (decisions[memberId]?.role === role) decisions[memberId] = { role: null };
        else {
            if (role === DUPLICATE_ROLES.KEEP) {
                for (const member of group.members) {
                    if (member.id !== memberId && decisions[member.id]?.role === DUPLICATE_ROLES.KEEP) {
                        decisions[member.id] = { role: DUPLICATE_ROLES.MERGE };
                    }
                }
            }
            decisions[memberId] = { role };
        }
        // Recalcula qué «otra persona» necesita ficha nueva con las decisiones actuales.
        for (const member of group.members) {
            if (decisions[member.id]?.role === DUPLICATE_ROLES.OTHER && member.id !== memberId) {
                decisions[member.id] = { role: DUPLICATE_ROLES.OTHER, number: decisions[member.id].number };
            }
        }
        this.view.decisions = withNumberSuggestions(group, decisions, this.ctx);
        this.render(false);
    }

    async ensureSnapshot() {
        if (this.snapshotTaken) return true;
        try {
            await this.deps.createSnapshot?.();
            this.snapshotTaken = true;
            return true;
        } catch (error) {
            console.error('No se pudo crear la copia de seguridad antes de resolver duplicados:', error);
            this.view.error = 'No se pudo crear la copia de seguridad. No se cambió nada.';
            this.render(false);
            return false;
        }
    }

    addTotals(result) {
        this.view.totals.merged += result.merged || 0;
        this.view.totals.renumbered += result.renumbered || 0;
        this.view.totals.deleted += result.deleted || 0;
    }

    afterResolve() {
        this.changed = true;
        this.view.error = '';
        const pending = this.view.groups.filter(g => !this.view.resolved[g.id]);
        this.view.step = pending.length ? 'list' : 'done';
        this.render(true);
    }

    async applyGroup() {
        const group = this.view.groups.find(g => g.id === this.view.groupId);
        const plan = group && planGroupDecisions(group, this.view.decisions, this.ctx);
        if (!plan?.ok || this.view.busy) return;
        if (!(await this.ensureSnapshot())) return;
        this.view.busy = true;
        this.render(false);
        try {
            const result = this.deps.applyPlan(group, plan);
            await this.deps.persist();
            this.addTotals(result);
            this.view.resolved[group.id] = true;
        } catch (error) {
            console.error('Error aplicando duplicados:', error);
            this.view.error = 'No se pudo guardar. Revisa tu conexión e inténtalo otra vez.';
        } finally {
            this.view.busy = false;
        }
        if (this.view.error) { this.render(false); return; }
        this.afterResolve();
    }

    async mergeSafe() {
        if (this.view.busy) return;
        const safe = this.view.groups.filter(g => g.safe && !this.view.resolved[g.id]);
        if (!safe.length || !(await this.ensureSnapshot())) return;
        this.view.busy = true;
        this.render(false);
        try {
            for (const group of safe) {
                const plan = planGroupDecisions(group, group.decisions, this.ctx);
                if (!plan.ok) continue;
                this.addTotals(this.deps.applyPlan(group, plan));
                this.view.resolved[group.id] = true;
            }
            await this.deps.persist();
        } catch (error) {
            console.error('Error uniendo duplicados seguros:', error);
            this.view.error = 'No se pudo guardar. Revisa tu conexión e inténtalo otra vez.';
        } finally {
            this.view.busy = false;
        }
        this.afterResolve();
    }

    dismissGroup() {
        const group = this.view.groups.find(g => g.id === this.view.groupId);
        if (!group) return;
        const dismissed = readDismissed();
        dismissed.add(group.id);
        writeDismissed(dismissed);
        this.view.resolved[group.id] = true;
        this.view.totals.dismissed++;
        this.afterResolve();
    }

    onClick(event) {
        if (event.target === this.overlay) return; // tocar fuera no cierra: evita perder decisiones
        const target = event.target.closest?.('[data-dup-action]');
        if (!target || target.disabled) return;
        const { dupAction: action, id, role } = target.dataset;
        if (action === 'close') this.close();
        else if (action === 'open-group') this.openGroup(id);
        else if (action === 'open-next') {
            const next = this.view.groups.find(g => !this.view.resolved[g.id]);
            if (next) this.openGroup(next.id);
        } else if (action === 'back') { this.view.step = 'list'; this.view.error = ''; this.render(true); }
        else if (action === 'set-role') this.setRole(id, role);
        else if (action === 'apply-group') this.applyGroup();
        else if (action === 'merge-safe') this.mergeSafe();
        else if (action === 'dismiss-group') this.dismissGroup();
        else if (action === 'finish') { this.view.step = 'done'; this.render(true); }
        else if (action === 'cloud-reconcile') { this.close(); this.deps.cloudReconcile?.(); }
    }

    onInput(event) {
        const id = event.target?.dataset?.dupNumber;
        if (!id) return;
        this.view.decisions = { ...this.view.decisions, [id]: { role: DUPLICATE_ROLES.OTHER, number: event.target.value.trim() } };
        this.render(false);
    }

    onKeydown(event) {
        if (event.key !== 'Escape' || !this.overlay) return;
        event.preventDefault();
        if (this.view.step === 'group') { this.view.step = 'list'; this.render(true); }
        else this.close();
    }
}

export default DuplicatesScreen;
