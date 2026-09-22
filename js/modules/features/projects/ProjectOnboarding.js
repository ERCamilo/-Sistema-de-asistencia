import { projectSetupService } from './ProjectSetupService.js';
import { peekEntityScope } from './EntityProjectScope.js';
import { getState } from '../employees/EmployeesUI.js';
import { saveApplicationData } from '../../services/PersistenceService.js';
import { attachProjectDialogA11y } from './ProjectDialogA11y.js';

const C = { bg: '#0f172a', panel: '#1e293b', panel2: '#334155', border: '#334155', text: '#f8fafc', dim: '#94a3b8', faint: '#64748b', accent: '#06b6d4', onAccent: '#0f172a', good: '#10b981', warn: '#f59e0b', bad: '#ef4444' };
const FIELD_STYLE = `width:100%;height:48px;padding:0 15px;border-radius:11px;border:1px solid ${C.border};background:${C.panel};font-size:16px;font-family:inherit;color:inherit;box-sizing:border-box;`;
const LBL = `display:block;font-size:12px;font-weight:600;color:${C.dim};margin-bottom:8px;`;
function esc(v) {
    return String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export { C, FIELD_STYLE, LBL, esc };

const ONBOARDING_MODAL_ID = 'project-create-modal';
let detachProjectOnboardingA11y = null;

export const defaultPersistenceService = {
    saveApplicationData: (opts = {}) => saveApplicationData({ immediate: true, ...opts })
};

export const DEFAULT_MANUAL_TEMPLATES = [
    { id: 'TPL-OFICIAL', name: 'Oficial Albañil', hourlyRate: 350, color: '#06b6d4' },
    { id: 'TPL-AYUDANTE', name: 'Ayudante', hourlyRate: 250, color: '#3b82f6' },
    { id: 'TPL-CAPATAZ', name: 'Capataz de Obra', hourlyRate: 450, color: '#10b981' }
];

function normalizedProjectId(value) {
    if (value === null || value === undefined) return null;
    const normalized = String(value).trim();
    return normalized || null;
}

/**
 * R04: clonación profunda segura para puestos/plantillas.
 * structuredClone cuando está disponible; JSON como respaldo para POJOs.
 * Garantiza independencia total de objetos/arreglos anidados.
 */
function deepClonePositionSource(value) {
    if (value === null || value === undefined) return value;
    if (typeof structuredClone === 'function') {
        try {
            return structuredClone(value);
        } catch (_) {
            // cae al respaldo JSON
        }
    }
    return JSON.parse(JSON.stringify(value));
}

function clonePositionForTarget(sourcePosition, targetProjectId, uniqueSuffix) {
    const base = deepClonePositionSource(sourcePosition) || {};
    return {
        ...base,
        id: `POS-CLONE-${uniqueSuffix}`,
        projectId: targetProjectId,
        leaderId: null // Crucial: líderes NUNCA cruzan de obra
    };
}

function assertPersistenceSuccess(result) {
    if (result === false) {
        throw new Error('No se pudo persistir la estructura de la obra (persistencia local no confirmada).');
    }
    if (result && typeof result === 'object' && !Array.isArray(result) && result.localOk === false) {
        throw new Error('No se pudo persistir la estructura de la obra (persistencia local no confirmada).');
    }
}

/**
 * Canonical ownership check for copy-source positions.
 * Legacy positions without projectId belong ONLY to the effective default project.
 */
export function positionBelongsToCopySource(position, {
    sourceProjectId = null,
    defaultProjectId = null
} = {}) {
    if (!position) return false;
    const sourceId = normalizedProjectId(sourceProjectId);
    if (!sourceId) return false;

    const explicitProjectId = normalizedProjectId(position.projectId);
    if (explicitProjectId) return explicitProjectId === sourceId;

    const defaultId = normalizedProjectId(defaultProjectId);
    return !!defaultId && defaultId === sourceId;
}

export function chip(text, mb = 16) {
    return `<div style="display:inline-flex;align-items:center;gap:8px;height:26px;padding:0 11px;border-radius:20px;background:${C.panel2};border:1px solid ${C.border};font-size:11px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:${C.accent};margin-bottom:${mb}px;white-space:nowrap;">${text}</div>`;
}

export function renderProjectOnboardingHTML(s = {}) {
    const phase = s.phase || 'choice';
    const step = s.step || 1;
    const mode = s.mode || s.source || 'empty';
    const projectName = s.projectName || '';
    const summary = s.summary || {};
    const positionsCount = Number.isFinite(summary.positionsCount) ? summary.positionsCount : 0;
    const employeesCount = Number.isFinite(summary.employeesCount) ? summary.employeesCount : 0;
    const errorMsg = s.error || s._choiceError || '';

    // Shell header
    const headerHTML = `
        <div data-od-id="od-topbar" class="odv-topbar" style="position:relative;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:18px 26px;border-bottom:1px solid ${C.border};">
            <div class="odv-topbar-brand" style="display:flex;align-items:center;gap:11px;min-width:0;">
                <div style="width:32px;height:32px;border-radius:8px;background:${C.panel2};display:flex;align-items:center;justify-content:center;color:${C.accent};">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V7l8-4 8 4v13"/><path d="M8 20v-5h8v5M8 9h.01M12 9h.01M16 9h.01"/></svg>
                </div>
                <div style="line-height:1.2;min-width:0;">
                    <div style="font-size:14px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">Nueva Obra</div>
                    <div style="font-size:11.5px;color:${C.faint};">Asistente de configuración de proyecto</div>
                </div>
            </div>
            <button type="button" data-act="cancel" aria-label="Cerrar asistente" style="width:44px;height:44px;min-height:44px;min-width:44px;border-radius:8px;border:none;background:transparent;color:${C.faint};cursor:pointer;display:flex;align-items:center;justify-content:center;">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l12 12M18 6 6 18"/></svg>
            </button>
        </div>`;

    if (phase === 'ready') {
        const pName = projectName.trim() || 'Nueva Obra';
        const row = (label, value) => `
            <div style="display:flex;align-items:center;justify-content:space-between;gap:14px;padding:13px 16px;border-bottom:1px solid ${C.border};">
                <span style="font-size:12.5px;color:${C.faint};">${esc(label)}</span>
                <span style="font-size:13px;font-weight:600;text-align:right;">${esc(value)}</span>
            </div>`;

        const modeLabel = mode === 'copy'
            ? 'Copiar estructura'
            : mode === 'manual'
                ? 'Configuración manual'
                : 'Empezar vacía';

        return `
            <div class="od-wrap odv-wrap project-shell" data-project-onboarding style="min-height:100%;display:flex;flex-direction:column;background:${C.bg};color:${C.text};">
                <div class="odv-card" style="position:relative;width:100%;max-width:680px;margin:0 auto;background:${C.panel};border:1px solid ${C.border};border-radius:20px;overflow:hidden;">
                    ${headerHTML}
                    <div data-od-id="od-ready" class="odv-ready" data-selected-source="${esc(s.sourceProjectId || '')}" data-source-project-id="${esc(s.sourceProjectId || '')}" style="padding:32px 30px;display:flex;flex-direction:column;justify-content:center;">
                        <div style="display:flex;align-items:center;gap:14px;margin-bottom:20px;">
                            <div style="width:48px;height:48px;flex:none;border-radius:50%;background:${C.good};color:${C.onAccent};display:flex;align-items:center;justify-content:center;">
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg>
                            </div>
                            <div>
                                <h1 style="margin:0;font-size:22px;font-weight:700;letter-spacing:-.012em;">Todo listo para empezar</h1>
                                <p style="margin:4px 0 0;font-size:13.5px;color:${C.dim};line-height:1.45;">La obra <strong>${esc(pName)}</strong> ha sido configurada y lista para operar.</p>
                            </div>
                        </div>
                        <div style="border:1px solid ${C.border};border-radius:14px;overflow:hidden;margin-bottom:18px;">
                            ${row('Nombre de la obra', pName)}
                            ${row('Modo de inicio', modeLabel)}
                            ${mode === 'copy' && s.sourceProjectId ? row('Obra origen', s.sourceProjectName || s.sourceProjectId) : ''}
                            ${row('Puestos clonados/creados', String(positionsCount))}
                            ${row('Personal asignado', `${employeesCount} empleados`)}
                            ${row('Ajustes posteriores', 'Ajustes → Proyectos y Personal')}
                        </div>
                        <div style="padding:12px 16px;border-radius:11px;background:${C.panel2};border:1px solid ${C.border};font-size:12.5px;color:${C.dim};line-height:1.5;">
                            Podrás agregar puestos, empleados y configurar tarifas o turnos en cualquier momento sin recargar la aplicación.
                        </div>
                        ${errorMsg ? `
                            <div role="alert" aria-live="assertive" style="margin-top:16px;padding:12px 15px;border-radius:11px;border:1px solid #ef4444;background:rgba(239,68,68,.09);color:#fca5a5;font-size:13px;line-height:1.5;">
                                ${esc(errorMsg)}
                            </div>` : ''}
                    </div>
                    <div data-od-id="od-footer" class="odv-ready-footer" style="display:flex;align-items:center;justify-content:flex-end;padding:16px 26px;border-top:1px solid ${C.border};">
                        <button type="button" data-act="next" data-project-onboarding-continue aria-label="Continuar a la obra" style="display:flex;align-items:center;justify-content:center;gap:8px;min-width:180px;height:44px;min-height:44px;padding:0 22px;border-radius:10px;border:none;background:${C.accent};color:${C.onAccent};font-size:14px;font-weight:700;cursor:pointer;">
                            Continuar a la obra
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                        </button>
                    </div>
                </div>
            </div>`;
    }

    if (phase === 'structure') {
        const isCopy = mode === 'copy';
        const pName = projectName.trim() || 'Nueva Obra';
        const availableProjects = Array.isArray(s.availableProjects) ? s.availableProjects : [];
        const availableTemplates = Array.isArray(s.availableTemplates) ? s.availableTemplates : DEFAULT_MANUAL_TEMPLATES;
        const selectedTemplateIds = Array.isArray(s.selectedTemplateIds) ? s.selectedTemplateIds : [];

        return `
            <div class="od-wrap odv-wrap project-shell odv-structure ${isCopy ? 'odv-source' : ''}" data-project-onboarding data-phase="structure" data-step="structure" data-od-id="od-structure" ${isCopy ? 'data-od-id="od-source" data-phase="source" data-step="source"' : 'data-manual-structure data-structure-step'} style="min-height:100%;display:flex;flex-direction:column;background:${C.bg};color:${C.text};">
                <div class="odv-card" style="position:relative;width:100%;max-width:680px;margin:0 auto;background:${C.panel};border:1px solid ${C.border};border-radius:20px;overflow:hidden;">
                    ${headerHTML}
                    <div data-od-id="od-structure" class="odv-structure ${isCopy ? 'odv-source' : ''}" data-phase="structure" data-step="structure" ${isCopy ? 'data-od-id="od-source" data-phase="source" data-step="source"' : 'data-manual-structure data-structure-step'} style="padding:30px 26px;display:flex;flex-direction:column;">
                        ${chip(isCopy ? 'Paso 2: Obra origen' : 'Paso 2: Estructura de puestos', 12)}
                        <h1 style="margin:0;font-size:23px;font-weight:700;letter-spacing:-.015em;line-height:1.2;">
                            ${isCopy ? 'Selecciona la obra origen' : 'Seleccionar plantillas de puestos'}
                        </h1>
                        <p style="margin:8px 0 20px;font-size:14px;color:${C.dim};line-height:1.5;">
                            ${isCopy
                                ? `Elige la obra activa de la cual clonar puestos de trabajo hacia "${esc(pName)}".`
                                : `Catálogo global: elige cero o más plantillas para "${esc(pName)}". Seleccionar es lo que habilita/copia en la obra como copia independiente sin empleados ni líderes.`}
                        </p>

                        ${isCopy ? `
                            <div role="radiogroup" aria-label="Seleccionar obra origen" style="display:grid;gap:10px;margin-bottom:20px;">
                                ${availableProjects.map(p => {
                                    const isSelected = s.sourceProjectId === p.id;
                                    return `
                                    <button type="button" role="radio"
                                        data-act="pick-source"
                                        data-source-id="${esc(p.id)}"
                                        data-source-option="${esc(p.id)}"
                                        aria-checked="${isSelected ? 'true' : 'false'}"
                                        aria-label="Obra ${esc(p.name)}"
                                        style="display:flex;gap:14px;align-items:center;text-align:left;width:100%;padding:14px 18px;min-height:48px;border-radius:14px;cursor:pointer;font:inherit;color:inherit;background:${isSelected ? C.panel2 : 'transparent'};border:1px solid ${isSelected ? C.accent : C.border};">
                                        <span style="width:36px;height:36px;flex:none;border-radius:10px;display:flex;align-items:center;justify-content:center;background:${isSelected ? C.accent : C.panel2};color:${isSelected ? C.onAccent : C.dim};border:1px solid ${isSelected ? C.accent : C.border};" aria-hidden="true">
                                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V7l8-4 8 4v13"/><path d="M8 20v-5h8v5"/></svg>
                                        </span>
                                        <span style="flex:1;min-width:0;">
                                            <span style="display:block;font-size:14px;font-weight:600;">${esc(p.name)}</span>
                                            <span style="display:block;font-size:12px;color:${C.dim};">ID: ${esc(p.id)}</span>
                                        </span>
                                        ${isSelected ? `
                                            <span style="color:${C.accent};">
                                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                                            </span>` : ''}
                                    </button>`;
                                }).join('')}
                                ${availableProjects.length === 0 ? `
                                    <div style="padding:16px;border-radius:12px;background:${C.panel2};color:${C.dim};font-size:13px;text-align:center;">
                                        No se encontraron otras obras activas disponibles para copiar.
                                    </div>` : ''}
                            </div>
                        ` : `
                            <div style="margin-bottom:12px;padding:10px 14px;border-radius:10px;background:${C.panel2};border:1px solid ${C.border};font-size:12.5px;color:${C.dim};line-height:1.5;" data-catalog-notice="global">
                                Catálogo global de plantillas (desprendidas de cualquier obra). Solo lo seleccionado se copia a la obra.
                            </div>
                            <div style="display:grid;gap:10px;margin-bottom:20px;">
                                ${availableTemplates.map(tpl => {
                                    const isChecked = selectedTemplateIds.includes(tpl.id);
                                    return `
                                    <div class="odv-template-card"
                                        data-template-id="${esc(tpl.id)}"
                                        data-position-template="${esc(tpl.name)}"
                                        data-structure-item="${esc(tpl.id)}"
                                        data-position-item="${esc(tpl.id)}"
                                        data-act="toggle-position"
                                        style="display:flex;align-items:center;gap:14px;padding:14px 18px;min-height:48px;border-radius:14px;cursor:pointer;border:1px solid ${isChecked ? C.accent : C.border};background:${isChecked ? C.panel2 : 'transparent'};">
                                        <input type="checkbox" name="positions" value="${esc(tpl.id)}" data-template-id="${esc(tpl.id)}"
                                            ${isChecked ? 'checked' : ''}
                                            style="width:20px;height:20px;min-height:20px;min-width:20px;accent-color:${C.accent};cursor:pointer;">
                                        <div style="flex:1;min-width:0;">
                                            <div style="font-size:14px;font-weight:600;">${esc(tpl.name)}</div>
                                            <div style="font-size:12px;color:${C.dim};">$${Number(tpl.hourlyRate) || 0}/h · catálogo global</div>
                                        </div>
                                    </div>`;
                                }).join('')}
                            </div>
                        `}

                        ${errorMsg ? `
                            <div role="alert" aria-live="assertive" style="margin-top:16px;padding:12px 15px;border-radius:11px;border:1px solid #ef4444;background:rgba(239,68,68,.09);color:#fca5a5;font-size:13px;line-height:1.5;">
                                ${esc(errorMsg)}
                            </div>` : ''}
                    </div>

                    <div data-od-id="od-footer" style="display:flex;align-items:center;justify-content:space-between;padding:16px 26px;border-top:1px solid ${C.border};">
                        <button type="button" data-act="back" style="display:flex;align-items:center;gap:7px;height:44px;min-height:44px;padding:0 18px;border-radius:10px;border:1px solid ${C.border};background:transparent;color:${C.dim};font-size:13.5px;font-weight:500;cursor:pointer;">
                            Atrás
                        </button>
                        <button type="button" data-act="next" style="display:flex;align-items:center;gap:7px;height:44px;min-height:44px;padding:0 22px;border-radius:10px;border:none;background:${C.accent};color:${C.onAccent};font-size:13.5px;font-weight:600;cursor:pointer;">
                            Siguiente
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>
                        </button>
                    </div>
                </div>
            </div>`;
    }

    // Default: Choice / Configuration Phase
    const card = (m, iconSvg, title, desc, disabled = false) => `
        <button type="button" role="radio" aria-checked="${mode === m ? 'true' : 'false'}" aria-label="${esc(title)}. ${esc(desc)}"
                data-act="pick" data-mode="${m}" data-v="${m}" ${disabled ? 'disabled aria-disabled="true"' : ''}
                style="display:flex;gap:14px;align-items:flex-start;text-align:left;width:100%;padding:16px 18px;min-height:48px;border-radius:14px;cursor:${disabled ? 'not-allowed' : 'pointer'};font:inherit;color:inherit;background:${mode === m ? C.panel2 : 'transparent'};border:1px solid ${mode === m ? C.accent : C.border};${disabled ? 'opacity:0.45;' : ''}">
            <span style="width:40px;height:40px;flex:none;border-radius:11px;display:flex;align-items:center;justify-content:center;background:${mode === m ? C.accent : C.panel2};color:${mode === m ? C.onAccent : C.dim};border:1px solid ${mode === m ? C.accent : C.border};" aria-hidden="true">${iconSvg}</span>
            <span style="flex:1;min-width:0;">
                <span style="display:block;font-size:14px;font-weight:600;">${esc(title)}</span>
                <span style="display:block;font-size:12.5px;color:${C.dim};margin-top:3px;line-height:1.45;">${esc(desc)}</span>
            </span>
        </button>`;

    return `
        <div class="od-wrap odv-wrap project-shell" data-project-onboarding style="min-height:100%;display:flex;flex-direction:column;background:${C.bg};color:${C.text};">
            <div class="odv-card" style="position:relative;width:100%;max-width:680px;margin:0 auto;background:${C.panel};border:1px solid ${C.border};border-radius:20px;overflow:hidden;">
                ${headerHTML}
                <div data-od-id="od-choice" class="odv-choice" style="padding:30px 26px;display:flex;flex-direction:column;">
                    ${chip('Punto de partida de la obra', 12)}
                    <h1 style="margin:0;font-size:23px;font-weight:700;letter-spacing:-.015em;line-height:1.2;">¿Cómo quieres empezar la nueva obra?</h1>
                    <p style="margin:8px 0 20px;font-size:14px;color:${C.dim};line-height:1.5;">Define el nombre de la obra y la estructura inicial de puestos de trabajo.</p>

                    <div style="margin-bottom:20px;">
                        <label style="${LBL}" for="project-onboarding-name-input">Nombre de la obra</label>
                        <input id="project-onboarding-name-input" type="text" class="odv-input" data-field="projectName" data-project-create-name maxlength="80"
                               placeholder="Ej. Torre Mirador, Obra Las Acacias" autocomplete="off" value="${esc(projectName)}"
                               style="${FIELD_STYLE}min-height:48px;height:48px;">
                        <div style="display:flex;justify-content:space-between;font-size:11.5px;color:${C.faint};margin-top:5px;">
                            <span>Máximo 80 caracteres</span>
                            <span data-project-create-char-count>${projectName.length}/80</span>
                        </div>
                    </div>

                    <div role="radiogroup" aria-label="Modo de inicio de la obra" style="display:grid;gap:10px;">
                        ${card(
                            'empty',
                            '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="9" y1="9" x2="15" y2="15"/><line x1="15" y1="9" x2="9" y2="15"/></svg>',
                            'Empezar vacía (desde cero)',
                            'Crea la obra completamente vacía: 0 puestos, 0 empleados, 0 asistencia y 0 préstamos.'
                        )}
                        ${card(
                            'copy',
                            '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
                            'Copiar estructura de otra obra',
                            'Clona los puestos con nuevos identificadores hacia esta obra. Empleados y líderes no se copian.'
                        )}
                        ${card(
                            'manual',
                            '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>',
                            'Configurar manualmente',
                            'Configura puestos y detalles directamente para la obra a tu ritmo.'
                        )}
                        ${card(
                            'import',
                            '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
                            'Importar datos (Diferido / Próximamente)',
                            'Importación selectiva diferida; utiliza restauración de backup completo en Ajustes si lo requieres.',
                            true
                        )}
                    </div>

                    ${errorMsg ? `
                        <div role="alert" aria-live="assertive" style="margin-top:16px;padding:12px 15px;border-radius:11px;border:1px solid #ef4444;background:rgba(239,68,68,.09);color:#fca5a5;font-size:13px;line-height:1.5;">
                            ${esc(errorMsg)}
                        </div>` : ''}
                </div>

                <div data-od-id="od-footer" style="display:flex;align-items:center;justify-content:space-between;padding:16px 26px;border-top:1px solid ${C.border};">
                    <button type="button" data-act="cancel" style="display:flex;align-items:center;gap:7px;height:44px;min-height:44px;padding:0 18px;border-radius:10px;border:1px solid ${C.border};background:transparent;color:${C.dim};font-size:13.5px;font-weight:500;cursor:pointer;">
                        Cancelar
                    </button>
                    <button type="button" data-act="next" style="display:flex;align-items:center;gap:7px;height:44px;min-height:44px;padding:0 22px;border-radius:10px;border:none;background:${C.accent};color:${C.onAccent};font-size:13.5px;font-weight:600;cursor:pointer;">
                        Siguiente
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>
                    </button>
                </div>
            </div>
        </div>`;
}

export const renderOnboardingView = renderProjectOnboardingHTML;

export async function copyProjectStructure({
    sourceProjectId,
    targetProjectId,
    defaultProjectId = null,
    positions = [],
    employees = []
} = {}) {
    const originPositions = (Array.isArray(positions) ? positions : []).filter(
        position => positionBelongsToCopySource(position, { sourceProjectId, defaultProjectId })
    );

    const clonedPositions = originPositions.map((pos, index) => {
        const uniqueSuffix = `${Date.now()}_${index}_${Math.random().toString(36).substring(2, 7)}`;
        return clonePositionForTarget(pos, targetProjectId, uniqueSuffix);
    });

    return {
        positions: clonedPositions,
        employees: [] // Empleados nunca se copian por defecto
    };
}

export const clonePositionsForProject = copyProjectStructure;

/**
 * R07 A2a — Onboarding de PRIMERA obra (first-project mode).
 *
 * Contrato explícito: NO crea un segundo proyecto. Configura (renombrando)
 * el proyecto default/activo YA EXISTENTE que ProjectsBoot/DefaultProject
 * garantizaron en el arranque. El caller decide usar este modo
 * (reuseExistingFirstProject); nunca se auto-detecta por conteo o nombre, y
 * los caminos normales de creación (createEmptyProject desde el menú
 * Proyectos) quedan intactos.
 *
 * Todo-o-nada: si el renombrado falla, no se tocó nada; si el clonado o la
 * persistencia de la estructura opcional falla DESPUÉS del renombrado, se
 * compensan los puestos clonados en memoria y se restaura el snapshot durable
 * previo del proyecto (sin obra a medio renombrar).
 */
export async function executeFirstProjectOnboarding({
    projectName,
    mode = 'empty',
    setupService = projectSetupService,
    selectedPositions = null,
    positions = null,
    persistenceService = defaultPersistenceService
} = {}) {
    const normalizedName = (projectName || '').trim();
    if (!normalizedName) {
        throw new Error('Escribe el nombre del proyecto.');
    }
    if (mode === 'copy') {
        // La primera obra no tiene otra obra activa de la cual copiar
        // estructura; el modo copy pertenece al onboarding de obras nuevas.
        throw new Error('El modo copiar estructura no está disponible para la primera obra.');
    }

    // 1. Reconfigurar el proyecto default ya existente (rename in-place).
    const renameResult = await setupService.renameDefaultProjectForOnboarding({ name: normalizedName });
    const targetProject = renameResult.project;
    const targetProjectId = targetProject.id;
    const previousProject = renameResult.previousProject;

    const createdPositionIds = [];

    try {
        let clonedPositions = [];

        // 2. Estructura opcional (modo manual): plantillas → puestos de esta obra.
        if (mode === 'manual' && Array.isArray(selectedPositions) && selectedPositions.length > 0) {
            clonedPositions = selectedPositions.map((pos, index) => {
                const uniqueSuffix = `${Date.now()}_${index}_${Math.random().toString(36).substring(2, 7)}`;
                const clone = clonePositionForTarget(pos, targetProjectId, uniqueSuffix);
                createdPositionIds.push(clone.id);
                return clone;
            });
        }

        // 3. Persistencia durable de la estructura antes de declarar éxito.
        if (clonedPositions.length > 0) {
            const globalState = typeof getState === 'function' ? getState() : null;
            let stateStartIndex = null;
            if (globalState && Array.isArray(globalState.positions)) {
                stateStartIndex = globalState.positions.length;
                clonedPositions.forEach(p => {
                    globalState.positions.push(p);
                });
            }
            await persistProjectPositions(persistenceService, clonedPositions);

            // R04: devolver referencias respaldadas por el estado para preservar
            // identidad por referencia con el proxy recursivo de AppState.
            if (globalState && Array.isArray(globalState.positions) && stateStartIndex !== null) {
                try {
                    const backed = [];
                    for (let i = 0; i < clonedPositions.length; i++) {
                        backed.push(globalState.positions[stateStartIndex + i]);
                    }
                    if (backed.length === clonedPositions.length && backed.every((b, idx) => b && b.id === clonedPositions[idx].id)) {
                        clonedPositions = backed;
                    }
                } catch (_) {}
            }
        }

        return {
            project: targetProject,
            state: renameResult.state,
            previousProject,
            positions: clonedPositions,
            reusedExistingProject: true
        };
    } catch (err) {
        // Rollback local in-memory SOLO de los puestos creados en este ciclo
        // (nunca de puestos previos que ya pertenecieran a este proyecto).
        if (createdPositionIds.length > 0) {
            const globalState = typeof getState === 'function' ? getState() : null;
            if (globalState && Array.isArray(globalState.positions)) {
                globalState.positions = globalState.positions.filter(
                    p => !(p && createdPositionIds.includes(p.id))
                );
            }
        }

        // Compensar el renombrado: restaurar el snapshot durable previo.
        let compensationError = null;
        try {
            if (typeof setupService?.restoreDefaultProjectSnapshot === 'function') {
                await setupService.restoreDefaultProjectSnapshot(previousProject);
            }
        } catch (compErr) {
            compensationError = compErr;
        }

        if (compensationError) {
            const combinedError = new Error(
                `Error durante el onboarding de la primera obra: ${err?.message || err}. La compensación del renombrado falló: ${compensationError?.message || compensationError}`
            );
            combinedError.cause = { persistenceError: err, compensationError };
            throw combinedError;
        }

        throw err;
    }
}

export async function persistProjectPositions(persistenceService, clonedPositions) {
    if (!persistenceService) {
        if (typeof saveApplicationData === 'function') {
            const result = await saveApplicationData({ immediate: true, requireLocalSuccess: true });
            assertPersistenceSuccess(result);
            return result;
        }
        return;
    }
    if (typeof persistenceService.savePositions === 'function') {
        const result = await persistenceService.savePositions(clonedPositions);
        assertPersistenceSuccess(result);
        return result;
    }
    if (typeof persistenceService.saveApplicationData === 'function') {
        const result = await persistenceService.saveApplicationData({ immediate: true, requireLocalSuccess: true });
        assertPersistenceSuccess(result);
        return result;
    }
    if (typeof persistenceService.batchUpdate === 'function') {
        const result = await persistenceService.batchUpdate('positions', clonedPositions);
        assertPersistenceSuccess(result);
        return result;
    }
    if (typeof persistenceService === 'function') {
        const result = await persistenceService(clonedPositions);
        assertPersistenceSuccess(result);
        return result;
    }
}

export async function executeProjectOnboarding({
    mode = 'empty',
    projectName,
    setupService = projectSetupService,
    sourceProjectId = null,
    selectedPositions = null,
    positions = null,
    persistenceService = defaultPersistenceService
} = {}) {
    const normalizedName = (projectName || '').trim();
    if (!normalizedName) {
        throw new Error('Escribe el nombre del proyecto.');
    }

    // 1. Create canonical project
    const createResult = await setupService.createEmptyProject({ name: normalizedName });
    const newProject = createResult.project;
    const targetProjectId = newProject.id;

    let defaultProjectId = normalizedProjectId(createResult?.state?.defaultProjectId);
    if (!defaultProjectId && typeof setupService?.getState === 'function') {
        const currentProjectState = await setupService.getState();
        defaultProjectId = normalizedProjectId(currentProjectState?.defaultProjectId);
    }

    const createdPositionIds = [];

    try {
        let clonedPositions = [];

        if (mode === 'copy' && sourceProjectId) {
            const currentPositions = Array.isArray(positions)
                ? positions
                : ((typeof getState === 'function' ? getState()?.positions : []) || []);
            const cloneResult = await copyProjectStructure({
                sourceProjectId,
                targetProjectId,
                defaultProjectId,
                positions: currentPositions,
                employees: []
            });
            clonedPositions = cloneResult.positions;
        } else if (mode === 'manual' && Array.isArray(selectedPositions) && selectedPositions.length > 0) {
            clonedPositions = selectedPositions.map((pos, index) => {
                const uniqueSuffix = `${Date.now()}_${index}_${Math.random().toString(36).substring(2, 7)}`;
                return clonePositionForTarget(pos, targetProjectId, uniqueSuffix);
            });
        }

        // Add cloned positions to in-memory state
        if (clonedPositions.length > 0) {
            const globalState = typeof getState === 'function' ? getState() : null;
            let stateStartIndex = null;
            if (globalState && Array.isArray(globalState.positions)) {
                stateStartIndex = globalState.positions.length;
                clonedPositions.forEach(p => {
                    globalState.positions.push(p);
                    createdPositionIds.push(p.id);
                });
            }

            // Durable persistence: must persist cloned positions before reporting success
            await persistProjectPositions(persistenceService, clonedPositions);

            // R04: devolver referencias respaldadas por el estado para preservar identidad
            // por referencia con el proxy recursivo de AppState (toContain).
            if (globalState && Array.isArray(globalState.positions) && stateStartIndex !== null) {
                try {
                    const backed = [];
                    for (let i = 0; i < clonedPositions.length; i++) {
                        backed.push(globalState.positions[stateStartIndex + i]);
                    }
                    if (backed.length === clonedPositions.length && backed.every((b, idx) => b && b.id === clonedPositions[idx].id)) {
                        clonedPositions = backed;
                    }
                } catch (_) {}
            }
        }

        return {
            project: newProject,
            state: createResult.state,
            positions: clonedPositions
        };
    } catch (err) {
        // Rollback local in-memory mutations on failure
        if (createdPositionIds.length > 0) {
            const globalState = typeof getState === 'function' ? getState() : null;
            if (globalState && Array.isArray(globalState.positions)) {
                globalState.positions = globalState.positions.filter(
                    p => !createdPositionIds.includes(p.id) && p.projectId !== targetProjectId
                );
            }
        }

        // Rollback/compensate newly created project in store
        let compensationError = null;
        try {
            if (typeof setupService?.compensateProjectCreation === 'function') {
                await setupService.compensateProjectCreation(targetProjectId);
            } else if (typeof setupService?.store?.delete === 'function') {
                await setupService.store.delete(targetProjectId);
            } else if (typeof setupService?.store?.remove === 'function') {
                await setupService.store.remove(targetProjectId);
            }
        } catch (compErr) {
            compensationError = compErr;
        }

        if (compensationError) {
            const combinedError = new Error(
                `Error during project onboarding: ${err?.message || err}. Rollback compensation failed: ${compensationError?.message || compensationError}`
            );
            combinedError.cause = { persistenceError: err, compensationError };
            throw combinedError;
        }

        throw err;
    }
}

export function handleProjectOnboardingAction(action, targetEl, state) {
    if (!action) return state;
    // Strictly no window.alert()
    return state;
}

export function mountProjectOnboarding(container, {
    setupService = projectSetupService,
    persistenceService = defaultPersistenceService,
    onSuccess = null,
    onCancel = null
} = {}) {
    if (!container) return null;

    let wizardState = {
        phase: 'choice',
        step: 1,
        mode: 'empty',
        projectName: '',
        sourceProjectId: null,
        sourceProjectName: '',
        defaultProjectId: null,
        availableProjects: [],
        availableTemplates: [],
        selectedTemplateIds: [],
        selectedPositions: [],
        clonedPositions: [],
        summary: {},
        error: null,
        isSubmitting: false
    };

    // Preload available projects
    if (typeof setupService?.store?.listAll === 'function') {
        setupService.store.listAll().then(projects => {
            if (Array.isArray(projects)) {
                wizardState.availableProjects = projects.filter(p => p.status === 'active');
            }
        }).catch(() => {});
    }

    function render() {
        if (wizardState.sourceProjectId) {
            container.dataset.sourceProjectId = wizardState.sourceProjectId;
        } else {
            delete container.dataset.sourceProjectId;
        }
        container.innerHTML = renderProjectOnboardingHTML(wizardState);
        bindEvents();
    }

    function bindEvents() {
        const nameInput = container.querySelector('[data-field="projectName"]');
        const charCount = container.querySelector('[data-project-create-char-count]');
        if (nameInput) {
            nameInput.addEventListener('input', e => {
                wizardState.projectName = e.target.value;
                if (charCount) charCount.textContent = `${e.target.value.length}/80`;
            });
        }

        container.querySelectorAll('[data-act="pick"]').forEach(btn => {
            btn.addEventListener('click', () => {
                if (btn.hasAttribute('disabled')) return;
                const v = btn.getAttribute('data-v') || btn.getAttribute('data-mode');
                if (v && v !== 'import') {
                    wizardState.mode = v;
                    render();
                }
            });
        });

        // Source project selection (buttons, radios, options)
        container.querySelectorAll('[data-act="pick-source"], [data-source-id], [data-source-option]').forEach(el => {
            el.addEventListener('click', () => {
                const sid = el.getAttribute('data-source-id') || el.getAttribute('data-source-option') || el.value;
                if (sid) {
                    wizardState.sourceProjectId = sid;
                    const found = wizardState.availableProjects.find(p => p.id === sid);
                    if (found) wizardState.sourceProjectName = found.name;
                    wizardState.error = null;
                    render();
                }
            });
        });

        const sourceSelect = container.querySelector('select[data-field="sourceProjectId"]');
        if (sourceSelect) {
            sourceSelect.addEventListener('change', e => {
                wizardState.sourceProjectId = e.target.value;
                const found = wizardState.availableProjects.find(p => p.id === e.target.value);
                if (found) wizardState.sourceProjectName = found.name;
                wizardState.error = null;
                render();
            });
        }

        // Manual mode template selection
        container.querySelectorAll('[data-act="toggle-position"], [data-template-id]').forEach(el => {
            el.addEventListener('click', e => {
                const tplId = el.getAttribute('data-template-id') || el.getAttribute('data-structure-item');
                if (!tplId) return;

                if (e.target.tagName === 'INPUT') {
                    const checked = e.target.checked;
                    if (checked && !wizardState.selectedTemplateIds.includes(tplId)) {
                        wizardState.selectedTemplateIds.push(tplId);
                    } else if (!checked) {
                        wizardState.selectedTemplateIds = wizardState.selectedTemplateIds.filter(id => id !== tplId);
                    }
                } else {
                    if (wizardState.selectedTemplateIds.includes(tplId)) {
                        wizardState.selectedTemplateIds = wizardState.selectedTemplateIds.filter(id => id !== tplId);
                    } else {
                        wizardState.selectedTemplateIds.push(tplId);
                    }
                }
                render();
            });
        });

        const cancelBtn = container.querySelector('[data-act="cancel"]');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => {
                onCancel?.();
            });
        }

        const backBtn = container.querySelector('[data-act="back"]');
        if (backBtn) {
            backBtn.addEventListener('click', () => {
                wizardState.phase = 'choice';
                wizardState.error = null;
                render();
            });
        }

        const nextBtn = container.querySelector('[data-act="next"]');
        if (nextBtn) {
            nextBtn.addEventListener('click', async () => {
                if (wizardState.isSubmitting) return;

                if (wizardState.phase === 'choice') {
                    const name = (wizardState.projectName || '').trim();
                    if (!name) {
                        wizardState.error = 'Escribe el nombre de la obra para continuar.';
                        render();
                        return;
                    }
                    wizardState.error = null;

                    if (wizardState.mode === 'empty') {
                        wizardState.phase = 'ready';
                        wizardState.step = 3;
                        wizardState.summary = {
                            positionsCount: 0,
                            employeesCount: 0
                        };
                        render();
                        return;
                    }

                    if (wizardState.mode === 'copy') {
                        const projectState = typeof setupService?.getState === 'function'
                            ? await setupService.getState()
                            : null;
                        wizardState.defaultProjectId = normalizedProjectId(projectState?.defaultProjectId);

                        const allProjects = Array.isArray(projectState?.projects)
                            ? projectState.projects
                            : ((typeof setupService.store?.listAll === 'function')
                                ? await setupService.store.listAll()
                                : []);
                        const activeProjects = allProjects.filter(p => p.status === 'active');
                        wizardState.availableProjects = activeProjects;
                        if (activeProjects.length === 1) {
                            wizardState.sourceProjectId = activeProjects[0].id;
                            wizardState.sourceProjectName = activeProjects[0].name;
                        } else {
                            wizardState.sourceProjectId = null;
                            wizardState.sourceProjectName = '';
                        }
                        wizardState.phase = 'structure';
                        wizardState.step = 2;
                        render();
                        return;
                    }

                    if (wizardState.mode === 'manual') {
                        const existingPositions = (typeof getState === 'function' ? getState()?.positions : []) || [];
                        // Decisión funcional explícita: el catálogo manual es global.
                        // Se presentan plantillas desprendidas (copias, sin referencia viva):
                        // seleccionar es lo que habilita/copia en la obra. Sin migrar datos ni cambiar modelo global.
                        wizardState.availableTemplates = existingPositions.length > 0
                            ? existingPositions.map(p => deepClonePositionSource({
                                id: p.id,
                                name: p.name,
                                hourlyRate: p.hourlyRate || 0,
                                color: p.color || '#06b6d4'
                            }))
                            : DEFAULT_MANUAL_TEMPLATES.map(tpl => deepClonePositionSource({ ...tpl }));
                        wizardState.selectedTemplateIds = [];
                        wizardState.phase = 'structure';
                        wizardState.step = 2;
                        render();
                        return;
                    }
                }

                if (wizardState.phase === 'structure') {
                    if (wizardState.mode === 'copy') {
                        if (!wizardState.sourceProjectId) {
                            wizardState.error = 'Selecciona una obra origen para continuar.';
                            render();
                            return;
                        }
                        wizardState.error = null;
                        const currentPositions = (typeof getState === 'function' ? getState()?.positions : []) || [];
                        const scopedPositions = currentPositions.filter(position => positionBelongsToCopySource(position, {
                            sourceProjectId: wizardState.sourceProjectId,
                            defaultProjectId: wizardState.defaultProjectId
                        }));
                        wizardState.summary = {
                            positionsCount: scopedPositions.length,
                            employeesCount: 0
                        };
                        wizardState.phase = 'ready';
                        wizardState.step = 3;
                        render();
                        return;
                    }

                    if (wizardState.mode === 'manual') {
                        wizardState.error = null;
                        const selected = (wizardState.availableTemplates || []).filter(
                            t => wizardState.selectedTemplateIds.includes(t.id)
                        );
                        wizardState.selectedPositions = selected;
                        wizardState.summary = {
                            positionsCount: selected.length,
                            employeesCount: 0
                        };
                        wizardState.phase = 'ready';
                        wizardState.step = 3;
                        render();
                        return;
                    }
                }

                if (wizardState.phase === 'ready') {
                    wizardState.isSubmitting = true;
                    try {
                        const result = await executeProjectOnboarding({
                            mode: wizardState.mode,
                            projectName: wizardState.projectName,
                            setupService,
                            sourceProjectId: wizardState.sourceProjectId,
                            selectedPositions: wizardState.selectedPositions,
                            persistenceService
                        });

                        // Switch active project without reload. El callback sólo
                        // recibe estado POST-switch: devolver createResult.state
                        // dejaba la UI creyendo que seguía activa la obra anterior.
                        let finalState = result.state;
                        if (typeof setupService.switchActiveProject === 'function') {
                            const switchResult = await setupService.switchActiveProject(result.project.id);
                            if (switchResult?.stale) {
                                throw new Error('El cambio a la nueva obra fue reemplazado por otra selección. Revisa el proyecto activo.');
                            }
                            finalState = switchResult?.state
                                || (typeof setupService.getState === 'function' ? await setupService.getState() : finalState);
                        } else if (typeof setupService.getState === 'function') {
                            finalState = await setupService.getState();
                        }

                        if (finalState?.activeProjectId
                            && String(finalState.activeProjectId) !== String(result.project.id)) {
                            throw new Error('La nueva obra se creó, pero no quedó activa. Selecciónala antes de crear puestos o empleados.');
                        }

                        window.dispatchEvent(new CustomEvent('projects:created', { detail: { project: result.project } }));
                        window.dispatchEvent(new CustomEvent('projects:setup-changed', { detail: { projectId: result.project.id } }));

                        onSuccess?.(result.project, finalState);
                    } catch (err) {
                        wizardState.error = err?.message || String(err);
                        render();
                    } finally {
                        wizardState.isSubmitting = false;
                    }
                }
            });
        }
    }

    render();

    return {
        focus: () => container.querySelector('[data-field="projectName"]')?.focus(),
        unmount: () => { container.innerHTML = ''; }
    };
}

export function closeProjectOnboardingModal() {
    detachProjectOnboardingA11y?.();
    detachProjectOnboardingA11y = null;
    document.getElementById(ONBOARDING_MODAL_ID)?.remove();
}

export async function openProjectOnboardingModal({
    setupService = projectSetupService,
    persistenceService = defaultPersistenceService,
    onSuccess = null,
    onCancel = null
} = {}) {
    closeProjectOnboardingModal();
    const state = await setupService.getState();
    if (!state.enabled) {
        window.showNotification?.('Proyectos no está activado.', 'error');
        return null;
    }

    const modalEl = document.createElement('div');
    modalEl.id = ONBOARDING_MODAL_ID;
    modalEl.className = 'project-shell-overlay';
    modalEl.style.zIndex = '10070';
    modalEl.innerHTML = `<div data-project-create-modal-slot role="dialog" aria-modal="true" aria-label="Nuevo proyecto" tabindex="-1" style="max-width:680px;width:100%;margin:auto;"></div>`;

    const handleClose = () => {
        closeProjectOnboardingModal();
        onCancel?.();
    };

    modalEl.addEventListener('click', event => {
        if (event.target === modalEl) handleClose();
    });
    document.body.appendChild(modalEl);
    detachProjectOnboardingA11y?.({ restoreFocus: false });
    detachProjectOnboardingA11y = attachProjectDialogA11y(modalEl, {
        onEscape: handleClose,
        focusInitial: false
    });

    const slot = modalEl.querySelector('[data-project-create-modal-slot]');
    const handle = mountProjectOnboarding(slot, {
        setupService,
        persistenceService,
        onSuccess: (project, nextState) => {
            closeProjectOnboardingModal();
            onSuccess?.(project, nextState);
        },
        onCancel: handleClose
    });
    handle?.focus();

    return modalEl;
}

export const ProjectOnboardingUI = {
    renderProjectOnboardingHTML,
    renderOnboardingView,
    copyProjectStructure,
    clonePositionsForProject,
    persistProjectPositions,
    executeProjectOnboarding,
    executeFirstProjectOnboarding,
    handleProjectOnboardingAction,
    mountProjectOnboarding,
    openProjectOnboardingModal,
    closeProjectOnboardingModal
};

export default ProjectOnboardingUI;
