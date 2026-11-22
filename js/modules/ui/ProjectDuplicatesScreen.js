/**
 * 🏗️ ProjectDuplicatesScreen — pantalla «Obras repetidas».
 *
 * Misma forma y lenguaje que «Duplicados» de empleados (DuplicatesScreen):
 *   Lista     → cada par sospechoso es una fila.
 *   Comparar  → una tarjeta por obra y, debajo, qué tiene cada una que la otra no.
 *   Listo     → resumen de lo que se decidió.
 * Mismo shell en los tres pasos (morph, sin cerrar y reabrir modales).
 *
 * La comparación vive en ProjectDuplicateReview, el descarte en
 * ProjectPairDismissals y la fusión en ProjectMergeService; aquí solo hay
 * presentación. Pasos extra: Fusionar (confirmar dirección, nombre y qué pasará)
 * y Fusionada (resumen; las personas repetidas se unen con «Duplicados»).
 */
import { escapeHTML } from '../utils/Sanitize.js';
import { buildProjectPairReviews } from '../features/projects/ProjectDuplicateReview.js';
import { SIMILARITY_LEVEL, ATTENDANCE_STATE } from '../features/projects/ProjectSimilarity.js';
import { suggestMergeDirection } from '../features/projects/ProjectMergeDirection.js';

const ICON = {
    obra: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20V7l8-4 8 4v13"/><path d="M8 20v-5h8v5M8 9h.01M12 9h.01M16 9h.01"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
    next: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7"/></svg>'
};

const LEVEL_LABEL = { [SIMILARITY_LEVEL.IDENTICAL]: 'Idéntica', [SIMILARITY_LEVEL.SIMILAR]: 'Parecida' };
const MAX_NAMES = 5;

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const initials = name => escapeHTML(String(name || '?').trim().split(/\s+/).map(part => part[0] || '').join('').slice(0, 2).toUpperCase());
const percent = score => `${Math.round((Number(score) || 0) * 100)} %`;

/** `2026-01-05` → `05/01/26`. */
function formatDay(value) {
    const [y, m, d] = String(value || '').split('-');
    return d && m && y ? `${d}/${m}/${y.slice(2)}` : '';
}
function formatTimestamp(value) {
    const time = Number(value);
    return Number.isFinite(time) && time > 0 ? formatDay(new Date(time).toISOString().slice(0, 10)) : '';
}
const rangeText = summary => (summary.from ? `${formatDay(summary.from)} – ${formatDay(summary.to)}` : 'Sin asistencia');

function namesText(people) {
    const names = people.map(person => person.name || '(sin nombre)');
    if (names.length <= MAX_NAMES) return names.join(', ');
    return `${names.slice(0, MAX_NAMES).join(', ')} y ${names.length - MAX_NAMES} más`;
}

function evidenceText(attendance) {
    switch (attendance.state) {
        case ATTENDANCE_STATE.SHARED:
            return `Las mismas personas tienen asistencia el mismo día en las dos obras (${plural(attendance.sharedDays, 'caso', 'casos')}). Es típico de una copia.`;
        case ATTENDANCE_STATE.INTERLEAVED:
            return 'Las fechas se intercalan: parece que se fue registrando en las dos obras a la vez.';
        case ATTENDANCE_STATE.ADJACENT:
            return 'Las fechas son seguidas: una obra continúa donde terminó la otra.';
        case ATTENDANCE_STATE.SEPARATED:
            return 'Las fechas están separadas por más de 30 días: pueden ser etapas distintas de una misma cuadrilla.';
        default:
            return 'Todavía no hay asistencia en las dos obras para comparar fechas.';
    }
}

// ───────────────────────────── render (puro) ─────────────────────────────

function renderHeader(view) {
    const subtitle = view.step === 'pair' ? 'Compara dos obras' : view.step === 'merge' ? 'Unir dos obras'
        : (view.step === 'done' || view.step === 'merged') ? 'Todo en orden' : 'Una obra, un solo registro';
    return `
        <header class="dup-header">
            <div class="dup-identity">${ICON.obra}</div>
            <div class="dup-heading">
                <h2 class="dup-title" id="pdup-title">Obras repetidas</h2>
                <div class="dup-subtitle">${subtitle}</div>
            </div>
            <button type="button" class="dup-icon-btn" data-pdup-action="close" aria-label="Cerrar">${ICON.close}</button>
        </header>`;
}

function renderPairRow(review, resolved) {
    const people = plural(review.matched, 'persona', 'personas');
    const status = resolved
        ? `<span class="dup-row-check" aria-label="Resuelto">${ICON.check}</span>`
        : `<span class="dup-status ${review.level === SIMILARITY_LEVEL.IDENTICAL ? 'is-good' : 'is-warn'}">${LEVEL_LABEL[review.level]}</span>`;
    return `
        <button type="button" class="dup-row ${resolved ? 'is-resolved' : ''}" data-pdup-action="open-pair" data-id="${escapeHTML(review.id)}"
                ${resolved ? 'disabled aria-disabled="true"' : ''}>
            <span class="dup-row-number">${percent(review.score)}</span>
            <span class="dup-row-main">
                <strong>${escapeHTML(review.a.name)} ⇄ ${escapeHTML(review.b.name)}</strong>
                <small>${people} en común</small>
            </span>
            ${status}
            ${resolved ? '' : `<span class="dup-row-chevron">${ICON.next}</span>`}
        </button>`;
}

function renderList(view) {
    const pending = view.pairs.filter(pair => !view.resolved[pair.id]);
    const identical = pending.filter(pair => pair.level === SIMILARITY_LEVEL.IDENTICAL).length;
    const similar = pending.length - identical;
    const error = view.error ? `<div class="dup-notice is-bad"><strong>${escapeHTML(view.error)}</strong></div>` : '';
    return `
        <div class="dup-body">
            <span class="dup-kicker">OBRAS</span>
            <h1 class="dup-h1">Obras que parecen la misma</h1>
            <p class="dup-lead">Comparamos su personal y su asistencia. Tú decides si son la misma obra.</p>
            ${error}
            <div class="dup-summary">
                <div class="dup-summary-tile is-good">
                    <span class="dup-metric">${identical}</span>
                    <span>${identical === 1 ? 'idéntica' : 'idénticas'}</span>
                </div>
                <div class="dup-summary-tile is-warn">
                    <span class="dup-metric">${similar}</span>
                    <span>${similar === 1 ? 'parecida' : 'parecidas'}</span>
                </div>
            </div>
            <div class="dup-list" role="list">
                ${view.pairs.map(pair => renderPairRow(pair, view.resolved[pair.id])).join('')}
            </div>
        </div>`;
}

function renderProjectCard(summary) {
    const created = formatTimestamp(summary.createdAt);
    return `
        <article class="dup-card" data-project="${escapeHTML(summary.id)}">
            <div class="dup-card-head">
                <span class="dup-avatar">${initials(summary.name)}</span>
                <div class="dup-card-name">
                    <strong>${escapeHTML(summary.name)}</strong>
                    <div class="dup-chips">${created ? `<span class="dup-chip">Creada ${created}</span>` : ''}</div>
                </div>
            </div>
            <dl class="dup-stats">
                <div><dt>Personal</dt><dd>${summary.people}</dd></div>
                <div><dt>Asistencias</dt><dd>${summary.days}</dd></div>
                <div><dt>Préstamos</dt><dd>${summary.loans}</dd></div>
            </dl>
            <div class="dup-inline">Fechas: ${rangeText(summary)}</div>
        </article>`;
}

function renderCompare(review) {
    const { a, b, diff } = review;
    const items = [];
    items.push(`<li>${plural(diff.both, 'persona está', 'personas están')} en las dos</li>`);
    const only = (people, name) => (people.length
        ? `<li>${plural(people.length, 'persona', 'personas')} solo en ${escapeHTML(name)}<small>${escapeHTML(namesText(people))}</small></li>` : '');
    items.push(only(diff.onlyA, a.name), only(diff.onlyB, b.name));
    const count = (n, one, many, name) => (n ? `<li>${plural(n, one, many)} solo en ${escapeHTML(name)}</li>` : '');
    items.push(count(diff.daysOnlyA, 'día de asistencia', 'días de asistencia', a.name), count(diff.daysOnlyB, 'día de asistencia', 'días de asistencia', b.name));
    items.push(count(diff.loansOnlyA, 'préstamo', 'préstamos', a.name), count(diff.loansOnlyB, 'préstamo', 'préstamos', b.name));
    let verdict = '';
    if (!review.adds.a && !review.adds.b) verdict = 'Son idénticas: no hay nada que pasar de una a otra.';
    else if (!review.adds.b) verdict = `${escapeHTML(b.name)} no tiene nada que no esté en ${escapeHTML(a.name)}.`;
    else if (!review.adds.a) verdict = `${escapeHTML(a.name)} no tiene nada que no esté en ${escapeHTML(b.name)}.`;
    return `
        <section class="dup-compare" aria-label="Diferencias entre las dos obras">
            <h3 class="dup-compare-title">Si fueran la misma obra</h3>
            <ul class="dup-compare-list">${items.filter(Boolean).join('')}</ul>
            ${verdict ? `<p class="dup-compare-verdict">${verdict}</p>` : ''}
            <p class="dup-compare-evidence">${escapeHTML(evidenceText(review.attendance))}</p>
        </section>`;
}

function renderPair(view) {
    const review = view.pairs.find(pair => pair.id === view.pairId);
    if (!review) return renderList(view);
    const error = view.error ? `<div class="dup-notice is-bad"><strong>${escapeHTML(view.error)}</strong></div>` : '';
    return `
        <div class="dup-body">
            <span class="dup-kicker">COMPARAR OBRAS · ${percent(review.score)}</span>
            <h1 class="dup-h1">¿Es la misma obra?</h1>
            <p class="dup-lead">Mira qué tiene cada una. Si no lo son, márcalo y no se vuelve a sugerir.</p>
            ${error}
            <div class="dup-cards is-2">${renderProjectCard(review.a)}${renderProjectCard(review.b)}</div>
            ${renderCompare(review)}
            ${view.canMerge ? '' : '<div class="dup-notice"><strong>La fusión de obras llegará en una próxima versión.</strong><p>Por ahora puedes revisar la comparación y marcar que no son la misma.</p></div>'}
        </div>`;
}

function renderMergeCard(summary, role) {
    const keep = role === 'keep';
    return `
        <article class="dup-card ${keep ? 'is-keep' : 'is-merge'}" data-project="${escapeHTML(summary.id)}">
            <div class="dup-card-head">
                <span class="dup-avatar">${initials(summary.name)}</span>
                <div class="dup-card-name">
                    <strong>${escapeHTML(summary.name)}</strong>
                    <div class="dup-chips"><span class="dup-chip ${keep ? 'is-info' : ''}">${keep ? 'Se conserva' : 'Se une y se retira'}</span></div>
                </div>
            </div>
            <dl class="dup-stats">
                <div><dt>Personal</dt><dd>${summary.people}</dd></div>
                <div><dt>Asistencias</dt><dd>${summary.days}</dd></div>
                <div><dt>Préstamos</dt><dd>${summary.loans}</dd></div>
            </dl>
        </article>`;
}

function mergeSides(view) {
    const review = view.pairs.find(pair => pair.id === view.pairId);
    const draft = view.mergeDraft;
    if (!review || !draft) return null;
    const byId = { [review.a.id]: review.a, [review.b.id]: review.b };
    return { review, keep: byId[draft.keepId], retire: byId[draft.retireId] };
}

function renderMergeWhatHappens({ review, keep, retire }, draft, locked) {
    const name = String(draft.name || '').trim();
    const items = [
        `Todo lo de ${escapeHTML(retire.name)} pasa a ${escapeHTML(keep.name)}: ${plural(retire.people, 'persona', 'personas')}, ${plural(retire.days, 'día de asistencia', 'días de asistencia')} y ${plural(retire.loans, 'préstamo', 'préstamos')}.`,
        `${plural(review.diff.both, 'persona está', 'personas están')} en las dos obras: quedarán repetidas y las unes enseguida con «Duplicados».`,
        name && name !== keep.name ? `${escapeHTML(keep.name)} pasará a llamarse «${escapeHTML(name)}».` : '',
        `${escapeHTML(retire.name)} se retira del catálogo. Tus otros dispositivos adoptan la fusión al sincronizar.`,
        'Antes de empezar se guarda una copia de seguridad.',
        locked ? 'La obra inicial se conserva siempre como referencia del sistema.' : ''
    ].filter(Boolean);
    return `
        <section class="dup-compare" aria-label="Qué pasará al fusionar">
            <h3 class="dup-compare-title">Qué pasará</h3>
            <ul class="dup-compare-list">${items.map(item => `<li>${item}</li>`).join('')}</ul>
        </section>`;
}

function renderMerge(view) {
    const sides = mergeSides(view);
    if (!sides) return renderList(view);
    const { keep, retire } = sides;
    const draft = view.mergeDraft;
    const locked = Boolean(view.defaultProjectId) && [sides.review.a.id, sides.review.b.id].includes(view.defaultProjectId);
    const blockers = draft.check && !draft.check.ok ? draft.check.blockers || [] : [];
    const error = view.error ? `<div class="dup-notice is-bad"><strong>${escapeHTML(view.error)}</strong></div>` : '';
    const blocked = blockers.length
        ? `<div class="dup-notice is-bad" role="alert"><strong>No se puede fusionar todavía</strong>${blockers.map(item => `<p>${escapeHTML(item.message)}</p>`).join('')}</div>` : '';
    return `
        <div class="dup-body">
            <span class="dup-kicker">FUSIONAR OBRAS</span>
            <h1 class="dup-h1">Unir en una sola obra</h1>
            <p class="dup-lead">Todo lo de una obra pasa a la otra y la primera se retira. Antes se guarda una copia de seguridad.</p>
            ${error}${blocked}
            <div class="dup-cards is-2">${renderMergeCard(keep, 'keep')}${renderMergeCard(retire, 'retire')}</div>
            <button type="button" class="dup-btn is-quiet" data-pdup-action="swap" ${locked || view.busy ? 'disabled aria-disabled="true"' : ''}>Invertir: conservar ${escapeHTML(retire.name)}</button>
            <label class="dup-field"><span>Nombre de la obra</span>
                <input type="text" data-pdup-name maxlength="80" autocomplete="off" value="${escapeHTML(draft.name)}" ${view.busy ? 'disabled' : ''}>
            </label>
            ${renderMergeWhatHappens(sides, draft, locked)}
        </div>`;
}

function renderMerged(view) {
    const merged = view.merged || { counts: {}, targetName: '' };
    const counts = merged.counts || {};
    const rows = [
        [counts.employees, 'personas'],
        [counts.attendance, 'registros de asistencia'],
        [counts.positions, 'puestos'],
        [counts.leaders, 'líderes']
    ].filter(([n]) => n > 0);
    return `
        <div class="dup-body dup-done">
            <span class="dup-done-check">${ICON.check}</span>
            <span class="dup-kicker">LISTO</span>
            <h1 class="dup-h1">Obras fusionadas</h1>
            <p class="dup-lead">Todo pasó a «${escapeHTML(merged.targetName)}». Los cambios se guardaron y se envían a tus otros dispositivos.</p>
            ${rows.length ? `<ul class="dup-done-list">${rows.map(([n, label]) => `<li><span class="dup-metric is-small">${n}</span>${label}</li>`).join('')}</ul>` : ''}
            ${merged.repeated ? `<div class="dup-notice is-warn"><strong>Ahora hay personas repetidas</strong><p>${plural(merged.repeated, 'persona está', 'personas están')} en las dos obras que se unieron. Únelas con «Duplicados».</p></div>` : ''}
        </div>`;
}

function renderDone(view) {
    const dismissed = view.totals.dismissed;
    return `
        <div class="dup-body dup-done">
            <span class="dup-done-check">${ICON.check}</span>
            <span class="dup-kicker">LISTO</span>
            <h1 class="dup-h1">${view.pairs.length ? 'Revisión terminada' : 'No hay obras repetidas'}</h1>
            <p class="dup-lead">${view.pairs.length ? 'Lo que marcaste se guardó y se envía a tus otros dispositivos.' : 'Cada obra tiene un personal distinto.'}</p>
            ${dismissed ? `<ul class="dup-done-list"><li><span class="dup-metric is-small">${dismissed}</span>${dismissed === 1 ? 'par marcado como distinto' : 'pares marcados como distintos'}</li></ul>` : ''}
        </div>`;
}

function renderFooter(view) {
    if (view.step === 'merge') {
        const blocked = view.mergeDraft?.check && !view.mergeDraft.check.ok;
        return `
            <footer class="dup-footer">
                <button type="button" class="dup-btn is-back" data-pdup-action="back" ${view.busy ? 'disabled aria-disabled="true"' : ''}>${ICON.back}<span>Volver</span></button>
                <span class="dup-hint"></span>
                <button type="button" class="dup-btn is-primary" data-pdup-action="confirm-merge" ${view.busy || blocked ? 'disabled aria-disabled="true"' : ''}>${view.busy ? 'Fusionando…' : 'Fusionar obras'}${ICON.check}</button>
            </footer>`;
    }
    if (view.step === 'merged') {
        return `
            <footer class="dup-footer">
                <button type="button" class="dup-btn is-back" data-pdup-action="close"><span>Listo</span></button>
                <span class="dup-hint"></span>
                <button type="button" class="dup-btn is-primary" data-pdup-action="review-duplicates">Revisar duplicados${ICON.next}</button>
            </footer>`;
    }
    if (view.step === 'pair' && view.canMerge) {
        return `
            <footer class="dup-footer">
                <button type="button" class="dup-btn is-back" data-pdup-action="back">${ICON.back}<span>Volver</span></button>
                <span class="dup-hint"><button type="button" class="dup-btn is-quiet" data-pdup-action="dismiss-pair" ${view.busy ? 'disabled aria-disabled="true"' : ''}>${view.busy ? 'Guardando…' : 'No son la misma'}</button></span>
                <button type="button" class="dup-btn is-primary" data-pdup-action="merge" ${view.busy ? 'disabled aria-disabled="true"' : ''}>Fusionar obras${ICON.next}</button>
            </footer>`;
    }
    if (view.step === 'pair') {
        return `
            <footer class="dup-footer">
                <button type="button" class="dup-btn is-back" data-pdup-action="back">${ICON.back}<span>Volver</span></button>
                <span class="dup-hint"></span>
                <button type="button" class="dup-btn is-primary" data-pdup-action="dismiss-pair" ${view.busy ? 'disabled aria-disabled="true"' : ''}>${view.busy ? 'Guardando…' : 'No son la misma'}${ICON.check}</button>
            </footer>`;
    }
    if (view.step === 'done' || view.step === 'loading') {
        return `
            <footer class="dup-footer">
                <span></span><span class="dup-hint">${view.step === 'loading' ? 'Comparando el personal de tus obras…' : ''}</span>
                <button type="button" class="dup-btn is-primary" data-pdup-action="close" ${view.step === 'loading' ? 'disabled' : ''}>Listo${ICON.check}</button>
            </footer>`;
    }
    const pending = view.pairs.some(pair => !view.resolved[pair.id]);
    return `
        <footer class="dup-footer">
            <button type="button" class="dup-btn is-back" data-pdup-action="close"><span>Cerrar</span></button>
            <span class="dup-hint"></span>
            ${pending
        ? `<button type="button" class="dup-btn is-primary" data-pdup-action="open-next">Revisar${ICON.next}</button>`
        : `<button type="button" class="dup-btn is-primary" data-pdup-action="finish">Terminar${ICON.check}</button>`}
        </footer>`;
}

/** HTML interior del shell para un estado de vista. */
export function renderProjectDuplicatesView(view) {
    const body = view.step === 'loading'
        ? '<div class="dup-body"><span class="dup-kicker">OBRAS</span><h1 class="dup-h1">Buscando obras repetidas…</h1><div class="dup-skeleton"></div><div class="dup-skeleton"></div></div>'
        : view.step === 'pair' ? renderPair(view)
            : view.step === 'merge' ? renderMerge(view)
                : view.step === 'merged' ? renderMerged(view)
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

export class ProjectDuplicatesScreen {
    constructor(deps = {}) {
        this.deps = deps;
        this.view = { step: 'loading', pairs: [], resolved: {}, totals: { dismissed: 0, merged: 0 }, canMerge: typeof deps.mergeProjects === 'function', defaultProjectId: '' };
        this.overlay = null;
        this.checkToken = 0;
        this.onClick = this.onClick.bind(this);
        this.onInput = this.onInput.bind(this);
        this.onKeydown = this.onKeydown.bind(this);
    }

    async open() {
        this.mount();
        this.render(false);
        await this.scan();
        this.view.step = this.view.error ? 'list' : this.view.pairs.length ? 'list' : 'done';
        this.render(true);
        return this;
    }

    mount() {
        const doc = globalThis.document;
        this.overlay = doc.createElement('div');
        this.overlay.className = 'dup-overlay';
        this.overlay.innerHTML = '<section class="dup-shell" role="dialog" aria-modal="true" aria-labelledby="pdup-title"></section>';
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
        this.deps.onClose?.();
    }

    async scan() {
        const deps = this.deps;
        try {
            const scope = deps.peekScope?.() || {};
            this.view.defaultProjectId = String(deps.getDefaultProjectId?.() || '').trim();
            const projects = await deps.listProjects();
            this.view.pairs = buildProjectPairReviews({
                projects,
                employees: deps.getEmployees?.() || [],
                attendance: deps.getAttendance?.() || [],
                defaultProjectId: scope.enabled ? scope.defaultProjectId || '' : ''
            });
        } catch (error) {
            console.error('No se pudieron comparar las obras:', error);
            this.view.pairs = [];
            this.view.error = 'No se pudieron leer las obras. Cierra y vuelve a intentarlo.';
        }
    }

    render(animate = false) {
        if (!this.shell) return;
        morph(this.shell, () => { this.shell.innerHTML = renderProjectDuplicatesView(this.view); }, animate);
        this.shell.classList.toggle('is-wide', ['pair', 'merge'].includes(this.view.step));
    }

    openPair(id) {
        if (!this.view.pairs.some(pair => pair.id === id)) return;
        this.view.step = 'pair';
        this.view.pairId = id;
        this.view.error = '';
        this.render(true);
        this.shell.querySelector('.dup-scroll')?.scrollTo?.(0, 0);
    }

    afterResolve() {
        this.view.error = '';
        const pending = this.view.pairs.some(pair => !this.view.resolved[pair.id]);
        this.view.step = pending ? 'list' : 'done';
        this.render(true);
    }

    async dismissPair() {
        const review = this.view.pairs.find(pair => pair.id === this.view.pairId);
        if (!review || this.view.busy) return;
        this.view.busy = true;
        this.view.error = '';
        this.render(false);
        try {
            await this.deps.dismissPair(review.a.id, review.b.id);
            this.view.resolved[review.id] = true;
            this.view.totals.dismissed++;
        } catch (error) {
            console.error('No se pudo guardar el descarte de obras:', error);
            this.view.error = 'No se pudo guardar. Revisa tu conexión e inténtalo otra vez.';
        } finally {
            this.view.busy = false;
        }
        if (this.view.error) { this.render(false); return; }
        this.afterResolve();
    }

    nameOf(id) {
        const review = this.view.pairs.find(pair => pair.id === this.view.pairId);
        return [review?.a, review?.b].find(side => side?.id === id)?.name || '';
    }

    openMerge() {
        const review = this.view.pairs.find(pair => pair.id === this.view.pairId);
        if (!review || !this.view.canMerge) return;
        const { keepId, retireId } = suggestMergeDirection(review.a, review.b, { defaultProjectId: this.view.defaultProjectId });
        this.view.mergeDraft = { keepId, retireId, name: this.nameOf(keepId), check: null };
        this.view.step = 'merge';
        this.view.error = '';
        this.render(true);
        this.shell.querySelector('.dup-scroll')?.scrollTo?.(0, 0);
        void this.runCheck();
    }

    /** Comprueba, sin escribir, si la fusión es posible. Si no puede comprobar, decide el motor al confirmar. */
    async runCheck() {
        const draft = this.view.mergeDraft;
        if (!draft) return;
        const token = ++this.checkToken;
        let check = { ok: true, blockers: [] };
        try {
            if (this.deps.checkMerge) check = await this.deps.checkMerge(draft.retireId, draft.keepId) || check;
        } catch (error) {
            console.warn('No se pudo comprobar la fusión de obras:', error?.message || error);
        }
        if (token !== this.checkToken || this.view.mergeDraft !== draft || !this.overlay) return;
        draft.check = check;
        this.render(false);
    }

    swapDirection() {
        const draft = this.view.mergeDraft;
        const review = this.view.pairs.find(pair => pair.id === this.view.pairId);
        if (!draft || !review || this.view.busy) return;
        if (this.view.defaultProjectId && [review.a.id, review.b.id].includes(this.view.defaultProjectId)) return;
        this.view.mergeDraft = { keepId: draft.retireId, retireId: draft.keepId, name: this.nameOf(draft.retireId), check: null };
        this.view.error = '';
        this.render(false);
        void this.runCheck();
    }

    async confirmMerge() {
        const draft = this.view.mergeDraft;
        const review = this.view.pairs.find(pair => pair.id === this.view.pairId);
        if (!draft || !review || this.view.busy || (draft.check && !draft.check.ok)) return;
        this.view.busy = true;
        this.view.error = '';
        this.render(false);
        let result;
        try {
            result = await this.deps.mergeProjects({ sourceId: draft.retireId, targetId: draft.keepId, projectName: draft.name });
        } catch (error) {
            console.error('Error al fusionar obras:', error);
            result = { ok: false, message: 'No se pudo fusionar las obras. No se cambió nada.' };
        } finally {
            this.view.busy = false;
        }
        if (!result?.ok) {
            this.view.error = result?.message || 'No se pudo fusionar las obras. No se cambió nada.';
            this.render(false);
            return;
        }
        this.view.merged = { counts: result.counts || {}, targetName: result.targetName || draft.name, repeated: review.diff.both };
        this.view.totals.merged++;
        this.view.mergeDraft = null;
        await this.scan(); // los pares cambian: la obra retirada ya no existe
        this.view.error = '';
        this.view.step = 'merged';
        this.render(true);
    }

    onClick(event) {
        if (event.target === this.overlay) return; // tocar fuera no cierra: evita perder la revisión
        const target = event.target.closest?.('[data-pdup-action]');
        if (!target || target.disabled) return;
        const { pdupAction: action, id } = target.dataset;
        if (action === 'close') this.close();
        else if (action === 'open-pair') this.openPair(id);
        else if (action === 'open-next') {
            const next = this.view.pairs.find(pair => !this.view.resolved[pair.id]);
            if (next) this.openPair(next.id);
        } else if (action === 'back') { this.view.step = this.view.step === 'merge' ? 'pair' : 'list'; this.view.error = ''; this.render(true); }
        else if (action === 'dismiss-pair') this.dismissPair();
        else if (action === 'merge') this.openMerge();
        else if (action === 'swap') this.swapDirection();
        else if (action === 'confirm-merge') this.confirmMerge();
        else if (action === 'review-duplicates') { this.close(); this.deps.openDuplicates?.(); }
        else if (action === 'finish') { this.view.step = 'done'; this.render(true); }
    }

    onInput(event) {
        if (!event.target?.matches?.('[data-pdup-name]') || !this.view.mergeDraft) return;
        this.view.mergeDraft.name = event.target.value; // sin repintar: no se pierde el foco al escribir
    }

    onKeydown(event) {
        if (event.key !== 'Escape' || !this.overlay) return;
        event.preventDefault();
        if (this.view.busy) return;
        if (this.view.step === 'merge') { this.view.step = 'pair'; this.view.error = ''; this.render(true); }
        else if (this.view.step === 'pair') { this.view.step = 'list'; this.render(true); }
        else this.close();
    }
}

export default ProjectDuplicatesScreen;
