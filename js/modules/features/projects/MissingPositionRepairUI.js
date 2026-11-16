/**
 * 🧩 Panel «Puestos no encontrados» del asistente de Multiobra.
 *
 * Solo HTML + flujo de guardado; la lógica vive en MissingPositionRepair.js.
 * ProjectReconciliationUI conecta los eventos (data-r07-action /
 * data-r07-prepair-*) y guarda `repairState` en su modalState.
 */
import { escapeHTML } from '../../utils/Sanitize.js';
import { formatCurrency } from '../../utils/Formatters.js';
import {
    planPositionRepair,
    applyPositionRepairPlan,
    undoPositionRepair,
    suggestRepairTarget
} from './MissingPositionRepair.js';

export const POSITION_REPAIR_UNDO_KEY = 'sa-position-repair-undo-v1';

const id = value => String(value ?? '').trim();
const plural = (count, one, many) => count + ' ' + (count === 1 ? one : many);

export function readPositionRepairUndo(storage = globalThis.localStorage) {
    try {
        const raw = storage?.getItem(POSITION_REPAIR_UNDO_KEY);
        const parsed = raw ? JSON.parse(raw) : null;
        return parsed?.version === 1 ? parsed : null;
    } catch (_) {
        return null;
    }
}

/** Estado inicial del panel: decisión sugerida por puesto (vacía si hay dudas). */
export function initialPositionRepairState(missingPositions = [], positions = [], { defaultProjectId = null, extraNames = {} } = {}) {
    const decisions = {};
    for (const item of missingPositions) {
        const named = extraNames[item.positionId] ? { ...item, name: extraNames[item.positionId] } : item;
        decisions[item.positionId] = suggestRepairTarget(named, positions, { defaultProjectId }).targetId || '';
    }
    return { decisions, salaries: {}, extraNames: { ...extraNames }, searching: false, busy: false, message: '' };
}

/** Decisiones con los salarios escritos, listas para planPositionRepair. */
export function repairDecisions(repairState) {
    const out = {};
    for (const [fromId, targetId] of Object.entries(repairState?.decisions || {})) {
        if (!id(targetId)) continue;
        const salaries = {};
        for (const [employeeId, value] of Object.entries(repairState.salaries?.[fromId] || {})) {
            const amount = Number(String(value).replace(',', '.'));
            if (Number.isFinite(amount) && amount > 0) salaries[employeeId] = amount;
        }
        out[fromId] = { targetId, salaries };
    }
    return out;
}

function positionLabel(position, defaultProjectId, projects) {
    const projectId = id(position?.projectId) || id(defaultProjectId);
    const project = (projects || []).find(item => id(item?.id) === projectId);
    return (position?.name || position?.id) + (project ? ' · ' + project.name : '');
}

export function renderMissingPositionsNotice(missingPositions = []) {
    if (!missingPositions.length) return '';
    const employees = new Set(missingPositions.flatMap(item => item.employeeIds)).size;
    return '<section class="r07-recon-note r07-missing-positions" aria-label="Puestos no encontrados">'
        + '<strong>' + missingPositions.length + ' ' + (missingPositions.length === 1 ? 'puesto no encontrado' : 'puestos no encontrados') + '</strong>'
        + '<span>' + employees + ' ' + (employees === 1 ? 'empleado apunta' : 'empleados apuntan')
        + ' a puestos que ya no están en el catálogo. No se borra nada: revisa a qué puesto actual corresponde cada uno.</span>'
        + '<button type="button" class="btn-secondary r07-recon-note-action" data-r07-action="open-position-repair">Revisar puestos</button>'
        + '</section>';
}

/**
 * @param {object} ctx {missingPositions, positions, projects, defaultProjectId, appState, hoursPerDay, repairState, undoAvailable}
 */
export function renderPositionRepairPanel(ctx) {
    const { missingPositions = [], positions = [], projects = [], defaultProjectId = null, appState = {}, hoursPerDay = 8,
        repairState = {}, undoAvailable = false } = ctx;
    const plan = planPositionRepair(appState, repairDecisions(repairState), { hoursPerDay });
    const options = [...positions].filter(position => !position?.deletedAt)
        .sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || ''), 'es'));
    const unnamed = missingPositions.filter(item => !(repairState.extraNames?.[item.positionId] || item.name));
    const cards = missingPositions.map(item => {
        const fromId = item.positionId;
        const name = repairState.extraNames?.[fromId] || item.name;
        const chosen = id(repairState.decisions?.[fromId]);
        const stats = plan.stats?.[fromId];
        const general = plan.generalRate.filter(row => row.fromId === fromId);
        const select = '<label class="r07-recon-field"><span>Pasar a</span>'
            + '<select data-r07-prepair-target="' + escapeHTML(fromId) + '"' + (repairState.busy ? ' disabled' : '') + '>'
            + '<option value="">No reparar por ahora</option>'
            + options.map(position => '<option value="' + escapeHTML(position.id) + '"' + (id(position.id) === chosen ? ' selected' : '') + '>'
                + escapeHTML(positionLabel(position, defaultProjectId, projects)) + '</option>').join('')
            + '</select></label>';
        const salaryRows = general.length
            ? '<div class="r07-missing-salaries"><p>' + general.length + ' ' + (general.length === 1 ? 'empleado no tiene' : 'empleados no tienen')
                + ' salario propio para este puesto. Usarán la tarifa general (' + escapeHTML(formatCurrency(general[0].hourlyRate * hoursPerDay))
                + ' por día) o escribe su salario diario.</p>'
                + general.map(row => '<label class="r07-recon-field r07-missing-salary"><span>#' + escapeHTML(String(row.number)) + ' ' + escapeHTML(row.name) + '</span>'
                    + '<input type="text" inputmode="decimal" placeholder="Tarifa general" data-r07-prepair-salary="' + escapeHTML(fromId) + '"'
                    + ' data-employee-id="' + escapeHTML(row.employeeId) + '" value="' + escapeHTML(repairState.salaries?.[fromId]?.[row.employeeId] || '') + '"'
                    + (repairState.busy ? ' disabled' : '') + '></label>').join('') + '</div>'
            : '';
        return '<article class="r07-missing-card">'
            + '<header><strong>' + escapeHTML(name || 'Nombre desconocido') + '</strong>'
            + '<small>' + plural(item.employeeIds.length, 'empleado', 'empleados') + ' · ' + plural(item.attendanceKeys.length, 'día', 'días')
                + ' · ' + item.salaryEmployeeIds.length + ' con salario propio</small>'
            + '<small class="r07-missing-id">ID ' + escapeHTML(fromId) + '</small></header>'
            + select
            + (chosen && stats ? '<p class="r07-recon-hint">Se pasan ' + plural(stats.salaries, 'salario', 'salarios')
                + (stats.keptExistingSalary ? ' (' + stats.keptExistingSalary + ' ya tenían salario en el destino y se conserva)' : '')
                + ' y ' + plural(stats.days, 'día', 'días') + '.</p>' : '')
            + (chosen ? salaryRows : '')
            + '</article>';
    }).join('');
    const chosenCount = Object.values(repairState.decisions || {}).filter(value => id(value)).length;
    const employeesChanged = plan.ok ? plan.employeeChanges.length : 0;
    const daysChanged = plan.ok ? plan.attendanceChanges.length : 0;
    return '<div class="r07-recon-shell r07-wizard" aria-busy="' + Boolean(repairState.busy) + '"><div class="r07-wizard-content">'
        + '<h2 id="r07-wizard-title" tabindex="-1">Puestos no encontrados</h2>'
        + '<p>Estos empleados apuntan a puestos que ya no existen. Elige a qué puesto actual corresponde cada uno. '
        + 'Antes de guardar se crea un respaldo protegido y podrás deshacer.</p>'
        + (unnamed.length ? '<p class="r07-recon-hint">' + unnamed.length + ' sin nombre conocido. '
            + '<button type="button" class="r07-recon-link-button" data-r07-action="position-repair-search"'
            + (repairState.searching || repairState.busy ? ' disabled' : '') + '>'
            + (repairState.searching ? 'Buscando en respaldos…' : 'Buscar nombres en respaldos') + '</button></p>' : '')
        + cards
        + (undoAvailable ? '<p class="r07-recon-hint">Hay una reparación anterior guardada en este dispositivo. '
            + '<button type="button" class="r07-recon-link-button" data-r07-action="position-repair-undo"'
            + (repairState.busy ? ' disabled' : '') + '>Deshacer la última reparación</button></p>' : '')
        + (repairState.message ? '<div class="r07-recon-message" role="status">' + escapeHTML(repairState.message) + '</div>' : '')
        + '</div><div class="r07-recon-footer">'
        + '<button type="button" class="btn-secondary r07-recon-footer-btn" data-r07-action="close-position-repair"'
        + (repairState.busy ? ' disabled' : '') + '>Atrás</button>'
        + '<div class="r07-recon-footer-hint" aria-live="polite">' + (chosenCount
            ? escapeHTML(plural(employeesChanged, 'empleado', 'empleados') + ' y ' + plural(daysChanged, 'día', 'días') + ' cambiarán') : 'Elige al menos un puesto') + '</div>'
        + '<button type="button" class="btn-primary r07-recon-footer-btn" data-r07-action="apply-position-repair"'
        + (!chosenCount || !plan.ok || repairState.busy ? ' disabled' : '') + '>'
        + (repairState.busy ? 'Guardando…' : 'Reparar ' + chosenCount + ' ' + (chosenCount === 1 ? 'puesto' : 'puestos')) + '</button>'
        + '</div></div>';
}

/**
 * Guarda la reparación: respaldo protegido → cambios → datos para deshacer →
 * guardado con las fechas tocadas (sube por el canal diario).
 * @param {object} deps {state, repairState, hoursPerDay, createSnapshot, batch, rebuildIndex, save, storage, now}
 */
export async function runPositionRepair(deps) {
    const { state, repairState, hoursPerDay = 8, createSnapshot, batch = fn => fn(), rebuildIndex = () => {},
        save, storage = globalThis.localStorage, now = Date.now() } = deps;
    const plan = planPositionRepair(state, repairDecisions(repairState), { hoursPerDay });
    if (!plan.ok) return { ok: false, message: 'Revisa los puestos elegidos: alguno ya no está disponible.' };
    try {
        await createSnapshot?.();
    } catch (error) {
        return { ok: false, message: 'No se pudo crear el respaldo previo. No se cambió nada; inténtalo con conexión.' };
    }
    let undo = null;
    batch(() => {
        undo = applyPositionRepairPlan(state, plan, { now });
        rebuildIndex();
    });
    try { storage?.setItem(POSITION_REPAIR_UNDO_KEY, JSON.stringify(undo)); } catch (_) { /* sin espacio: queda el respaldo */ }
    await save?.({ dateKeys: plan.dateKeys, immediate: true });
    return { ok: true, plan, undo };
}

export async function runPositionRepairUndo(deps) {
    const { state, batch = fn => fn(), rebuildIndex = () => {}, save, storage = globalThis.localStorage, now = Date.now() } = deps;
    const undo = readPositionRepairUndo(storage);
    if (!undo) return { ok: false, message: 'No hay una reparación para deshacer en este dispositivo.' };
    let result = null;
    batch(() => {
        result = undoPositionRepair(state, undo, { now });
        rebuildIndex();
    });
    try { storage?.removeItem(POSITION_REPAIR_UNDO_KEY); } catch (_) {}
    await save?.({ dateKeys: result.dateKeys, immediate: true });
    return { ok: true, result };
}
