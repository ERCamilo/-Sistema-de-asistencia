/**
 * 🧹 MaintenanceUI.js - Interfaz de Saneamiento de Datos
 * Proporciona el asistente para resolver duplicados e inconsistencias.
 * 
 * Flujos:
 *   - Auto: fusiona nombres iguales, abre reasignación para nombres diferentes
 *   - Manual: el usuario elige maestro por cada conflicto
 *   - Omitir: abre sub-modal de reasignación de ficha
 */

import { Modal } from '../components/Modal.js';
import { analyzeConflicts, mergeEmployees, executeAutoRepair, reassignEmployeeNumber, saveApplicationData } from '../services/PersistenceService.js';
import { buildConflictPlan, executeMergePlan } from '../services/ConflictPlanner.js';
import { EmployeeRepository } from '../services/EmployeeRepository.js';
import { validateManualGroup } from '../services/ManualGroupValidator.js';
import { reconcileCloudFromLocal } from '../services/CloudReconcile.js';
import { classifyEmployeeId, idFormatLabel } from '../services/IdFormat.js';
import { state, stateManager } from '../core/AppState.js';
import { Notification as NotificationSystem } from '../components/Notification.js';
import { canDeleteDuplicateEmployee } from '../services/EmployeeDeletionGuard.js';
import { enqueueEmployeeTombstone } from '../services/PersistenceService.js';
import { escapeHTML } from '../utils/Sanitize.js';

// ============================================
// 🎯 EVENT DELEGATION (data-maint-action)
// ============================================
const _MAINT_ACTION_MAP = {
    'auto-choice': () => window._maintenanceUI?.handleAutoChoice(),
    'manual-choice': () => window._maintenanceUI?.handleManualChoice(),
    'skip-step': () => window._maintenanceUI?.skipStep(),
    'resolve-conflict': (id) => window._maintenanceUI?.resolveConflict(id),
    'skip-reassignment': () => window._maintenanceUI?.skipReassignment(),
    'force-comparison': () => window._maintenanceUI?.forceComparison(),
    'apply-reassignment': () => window._maintenanceUI?.applyReassignment(),
    'apply-plan': () => window._maintenanceUI?.handleApplyPlan(),
    'cancel-plan': () => window._maintenanceUI?.cancelPlan(),
    'review-all-manually': () => window._maintenanceUI?.reviewAllManually(),
    'set-member-role': (memberId, target) => {
        const role = target?.dataset?.role || null;
        window._maintenanceUI?.setMemberRole(memberId, role);
    },
    'apply-manual-group': () => window._maintenanceUI?.applyManualGroup(),
    'cloud-reconcile': () => window._maintenanceUI?.handleCloudReconcile(),
    'commit-reassign-ficha': (id) => window._maintenanceUI?.commitReassignFicha(id)
};

function _handleMaintClick(e) {
    const target = e.target.closest('[data-maint-action]');
    if (!target) return;
    const action = target.dataset.maintAction;
    const handler = _MAINT_ACTION_MAP[action];
    if (!handler) return;
    const arg = target.dataset.id ?? target.dataset.value ?? null;
    handler(arg, target, e);
}

function _handleMaintKeydown(e) {
    // Enter dentro del input inline de reasignación → commit.
    if (e.key === 'Enter' && e.target?.classList?.contains('maintenance-reassign-input')) {
        e.preventDefault();
        const id = e.target.dataset?.id;
        if (id) window._maintenanceUI?.commitReassignFicha(id);
        return;
    }
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const target = e.target.closest('[data-maint-action]');
    if (!target || target.tagName === 'BUTTON' || target.tagName === 'A') return;
    if (target.getAttribute('role') !== 'button') return;
    e.preventDefault();
    _handleMaintClick(e);
}

let _maintDelegationAttached = false;
function _attachMaintDelegation() {
    if (_maintDelegationAttached) return;
    document.addEventListener('click', _handleMaintClick);
    document.addEventListener('keydown', _handleMaintKeydown);
    _maintDelegationAttached = true;
}
_attachMaintDelegation();

export class MaintenanceUI {
    constructor() {
        this.conflicts = [];
        this.currentConflictIndex = 0;
        this.modal = null;
        this.mergeCount = 0; // Acumulador de fusiones pendientes de guardar
    }

    /**
     * Inicia el proceso de mantenimiento.
     *
     * Si la cuenta ya migró (schemaVersion >= 2) y hay sesión, precarga
     * la subcolección de empleados de Firebase para detectar también
     * duplicados cloud-only. Luego construye un plan clasificado por
     * exactitud de nombre (opción B) y muestra un preview.
     */
    async start() {
        // 1. Cargar la subcolección remota si aplica (puede tardar).
        let cloudEmployees = [];
        const isMigrated = (typeof state.settings?.schemaVersion === 'number') && state.settings.schemaVersion >= 2;
        const hasUser = typeof globalThis !== 'undefined' && !!globalThis.currentUser;
        if (isMigrated && hasUser) {
            try {
                // M1: loadAll() puede devolver null ante fallo de lectura → []
                cloudEmployees = (await EmployeeRepository.loadAll()) || [];
            } catch (e) {
                console.warn('⚠️ No se pudo leer la subcolección de empleados:', e);
                cloudEmployees = [];
            }
        }

        // 2. Detectar conflictos local + cloud.
        this.conflicts = analyzeConflicts({ cloudEmployees });

        if (this.conflicts.length === 0) {
            NotificationSystem.info('✨ No se encontraron duplicados que requieran atención.');
            return;
        }

        // 3. Construir el plan clasificado por exactitud de nombre (opción B).
        this.plan = buildConflictPlan(this.conflicts);

        // 4. Mostrar preview con auto-merges y pendings manuales separados.
        this.showPlanPreview();
    }

    /**
     * Modal de preview: muestra el plan completo antes de aplicar nada.
     * Separa los auto-merges (nombres idénticos, seguros) de los que
     * requieren revisión manual (nombres con cualquier diferencia).
     */
    showPlanPreview() {
        const plan = this.plan || [];
        const autoMerges  = plan.filter(p => p.action === 'auto-merge');
        const needsManual = plan.filter(p => p.action === 'needs-manual');

        const autoBlock = autoMerges.length === 0 ? '' : `
            <div class="maintenance-plan-card is-auto">
                <div class="maintenance-plan-title">
                    Fusiones seguras (${autoMerges.length})
                </div>
                <div class="maintenance-plan-copy">
                    Estos nombres coinciden. El sistema puede unirlos conservando asistencia, préstamos e historial.
                </div>
                <ul class="maintenance-plan-list">
                    ${autoMerges.map(p => {
                        const masterName = (p.members.find(m => m.id === p.proposedMasterId) || {}).name || '?';
                        const cloudTag = p.hasCloudLosers ? ' <span>Incluye nube</span>' : '';
                        return `<li>Ficha ${p.number} · <strong>${masterName}</strong> (${p.members.length} duplicados → 1, ${p.totalLoansAfterMerge} préstamos)${cloudTag}</li>`;
                    }).join('')}
                </ul>
            </div>
        `;

        const manualBlock = needsManual.length === 0 ? '' : `
            <div class="maintenance-plan-card is-manual">
                <div class="maintenance-plan-title">
                    Revisar contigo (${needsManual.length})
                </div>
                <div class="maintenance-plan-copy">
                    Hay diferencias en los nombres. La app te preguntará caso por caso antes de tocar esos registros.
                </div>
                <ul class="maintenance-plan-list">
                    ${needsManual.map(p => {
                        const names = p.members.map(m => `"${m.name}"`).join(' vs ');
                        return `<li>Ficha ${p.number} · ${names}</li>`;
                    }).join('')}
                </ul>
            </div>
        `;

        const content = `
            <div class="maintenance-plan-preview">
                <p class="maintenance-plan-intro">
                    Se detectaron <strong>${plan.length} grupos</strong> de empleados con número de ficha duplicado.
                    Antes de aplicar cambios se crea una copia de seguridad.
                </p>
                ${autoBlock}
                ${manualBlock}
                <div class="maintenance-actions">
                    ${autoMerges.length > 0 ? `
                        <button type="button" class="maintenance-apply-btn" data-maint-action="apply-plan">
                            Aplicar ${autoMerges.length} fusión${autoMerges.length === 1 ? '' : 'es'} segura${autoMerges.length === 1 ? '' : 's'}${needsManual.length > 0 ? ` y revisar ${needsManual.length}` : ''}
                        </button>
                    ` : `
                        <button type="button" class="maintenance-apply-btn" data-maint-action="manual-choice">
                            Revisar manualmente (${needsManual.length})
                        </button>
                    `}
                    <button type="button" class="maintenance-secondary-btn" data-maint-action="review-all-manually"
                            title="Forzar revisión manual de TODOS los conflictos, incluyendo los que el sistema clasificó como seguros para auto-fusión.">
                        Revisar todo manualmente (${plan.length})
                    </button>
                    <button type="button" class="maintenance-secondary-btn" data-maint-action="cloud-reconcile"
                            title="Toma los empleados locales como verdad y limpia la nube: borra los docs huérfanos que el wizard no eliminó y vuelve a empujar la versión local. Úsalo si ves préstamos o adelantos que aparecen y desaparecen tras la sincronización.">
                        Forzar limpieza nube ↔ local
                    </button>
                    <button type="button" class="maintenance-ghost-btn" data-maint-action="cancel-plan">
                        Cancelar
                    </button>
                </div>
            </div>
        `;

        if (this.modal && this.modal.isOpen) {
            this.modal.updateContent(content);
            this.modal.title = 'Saneamiento de Datos';
        } else {
            this.modal = new Modal({
                title: 'Saneamiento de Datos',
                subtitle: 'Plan de resolución de conflictos',
                content,
                size: 'medium'
            }).open();
        }
        window._maintenanceUI = this;
    }

    /**
     * Aplica el plan: snapshot pre-cloud-dedup → executeMergePlan
     * → saveApplicationData → si hay pendings manuales, abrir wizard.
     */
    async handleApplyPlan() {
        const plan = this.plan || [];
        if (plan.length === 0) return;

        // 1. Snapshot de seguridad. Si falla, abortamos (preservar invariante
        //    "nunca destruimos sin red de seguridad").
        try {
            if (globalThis.createFirebaseSnapshot) {
                await globalThis.createFirebaseSnapshot('pre-restore', 'pre-cloud-dedup');
            }
        } catch (e) {
            console.error('No se pudo crear el snapshot pre-cloud-dedup:', e);
            NotificationSystem.error('No se pudo crear el snapshot de seguridad. Cancelando.');
            return;
        }

        // 2. Ejecutar el plan (solo auto-merges; los manuales se separan).
        let result;
        try {
            result = executeMergePlan(plan);
        } catch (e) {
            console.error('Error al ejecutar el plan:', e);
            NotificationSystem.error('Error durante la fusión. Revisa el snapshot.');
            return;
        }

        // 3. Guardar. saveApplicationData también drena _pendingCloudDeletes
        //    (Tarea #18) para limpiar los docs huérfanos en la subcolección.
        await saveApplicationData({ skipValidation: false, clearAttendance: true });

        // 4. Pasar a manual si quedaron conflictos por revisar.
        const manuals = plan.filter(p => p.action === 'needs-manual');
        if (manuals.length > 0) {
            this.conflicts = manuals.map(p => ({
                number: p.number,
                members: p.members
            }));
            this.currentConflictIndex = 0;
            this.mergeCount = result.merged || 0;
            this.showWizardStep();
            return;
        }

        // 5. Cerrar modal con resumen.
        if (this.modal) this.modal.close();
        NotificationSystem.success(`✅ Plan aplicado: ${result.merged} fusión${result.merged === 1 ? '' : 'es'} completada${result.merged === 1 ? '' : 's'}.`);
        if (globalThis.render) globalThis.render();
    }

    /**
     * Cancelar el plan: cierra el modal sin tocar nada.
     */
    cancelPlan() {
        if (this.modal) this.modal.close();
    }

    /**
     * Red de seguridad: cuando el wizard quedó a medias y la nube
     * conserva docs huérfanos (los UUIDs absorbidos que nunca se
     * borraron, normalmente por una cascada de reasignación que falló),
     * este flujo toma el state local como verdad y limpia la nube:
     *
     *   - Borra de users/{uid}/employees/ todo doc cuyo id no esté en el
     *     state local.
     *   - Re-empuja los empleados locales con mergeRemote:true para
     *     reflejar la versión saneada en cada doc.
     *
     * Requiere snapshot previo (red de seguridad estándar) y muestra
     * preview con el conteo de huérfanos antes de aplicar.
     */
    async handleCloudReconcile() {
        const isMigrated = (typeof state.settings?.schemaVersion === 'number') && state.settings.schemaVersion >= 2;
        const hasUser = typeof globalThis !== 'undefined' && !!globalThis.currentUser;
        if (!isMigrated || !hasUser) {
            NotificationSystem.error('La reconciliación requiere sesión activa y cuenta migrada al modelo per-doc.');
            return;
        }

        // 1. Leer nube y calcular preview
        let cloud = [];
        try {
            cloud = await EmployeeRepository.loadAll();
        } catch (e) {
            console.error('No se pudo leer la subcolección de empleados:', e);
            NotificationSystem.error('No se pudo leer la nube. Revisa tu conexión.');
            return;
        }
        // M1: null = fallo de lectura señalado por el repo (loadAll ya no lanza).
        // No calcular huérfanos sobre una lectura fallida; abortar con aviso.
        if (cloud === null) {
            NotificationSystem.error('No se pudo leer la nube. Revisa tu conexión.');
            return;
        }
        const localIds = new Set(state.employees.map(e => String(e.id)));
        const orphans = cloud.filter(c => c && c.id && !localIds.has(String(c.id)));

        if (orphans.length === 0) {
            NotificationSystem.info('✨ La nube ya está alineada con local. Nada que reconciliar.');
            return;
        }

        // 2. Confirmación con detalle
        const orphanPreview = orphans.slice(0, 6)
            .map(o => `<li><code>${o.id}</code> · ${o.name || '?'}</li>`)
            .join('');
        const more = orphans.length > 6 ? `<li>… y ${orphans.length - 6} más</li>` : '';
        const confirm = await Modal.confirm({
            title: 'Forzar limpieza nube ↔ local',
            message: `
                <p>Se detectaron <strong>${orphans.length} documentos huérfanos</strong> en la nube que no existen en local.</p>
                <p>Esta acción los <strong>borrará</strong> de Firestore y re-empujará los ${state.employees.length} empleados locales como verdad.</p>
                <p><strong>Huérfanos a eliminar:</strong></p>
                <ul style="margin: 0 0 8px 18px; font-size: 0.9em;">${orphanPreview}${more}</ul>
                <p style="font-size: 0.85em; opacity: 0.8;">Se crea snapshot de seguridad antes de empezar.</p>
            `,
            confirmText: `Sí, eliminar ${orphans.length} y reconciliar`,
            cancelText: 'Cancelar'
        });
        if (!confirm) return;

        // 3. Snapshot previo
        try {
            if (globalThis.createFirebaseSnapshot) {
                await globalThis.createFirebaseSnapshot('pre-restore', 'pre-cloud-reconcile');
            }
        } catch (e) {
            console.error('No se pudo crear snapshot pre-cloud-reconcile:', e);
            NotificationSystem.error('No se pudo crear el snapshot de seguridad. Cancelando.');
            return;
        }

        // 4. Ejecutar reconciliación
        try {
            const res = await reconcileCloudFromLocal(state.employees, {
                repository: EmployeeRepository
            });
            const summary = `${res.deleted.length} huérfanos borrados · ${res.written} empleados re-empujados`;
            if (res.errors.length > 0) {
                console.warn('Reconciliación con errores parciales:', res.errors);
                NotificationSystem.error(`Reconciliación parcial: ${summary}. ${res.errors.length} errores — revisa la consola.`);
            } else {
                NotificationSystem.success(`✅ Reconciliación completa: ${summary}.`);
            }
        } catch (e) {
            console.error('Error en reconcileCloudFromLocal:', e);
            NotificationSystem.error('Error durante la reconciliación. Revisa la consola.');
            return;
        }

        if (this.modal) this.modal.close();
        if (globalThis.render) globalThis.render();
    }

    /**
     * (Tarea #25) Forzar todos los conflictos a revisión manual,
     * incluso los que el sistema clasificó como auto-mergeables.
     *
     * Útil cuando el usuario quiere control total sobre cada fusión,
     * por ejemplo después de notar un caso en que la auto-detección
     * eligió un master que él prefiere cambiar.
     */
    reviewAllManually() {
        // Conservamos las conflicts originales pero las pasamos todas al
        // wizard manual. No tocamos auto-merges (no las hemos ejecutado).
        this.currentConflictIndex = 0;
        this.mergeCount = 0;
        this.showWizardStep();
    }

    /**
     * Muestra el modal inicial para elegir entre Auto y Manual
     */
    showSelectionModal() {
        const content = `
            <div class="maintenance-selection">
                <p class="maintenance-plan-intro">Se han detectado <strong>${this.conflicts.length} grupos</strong> de empleados con números de ficha duplicados.</p>
                
                <div class="choice-card auto-choice" role="button" tabindex="0" data-maint-action="auto-choice"
                     aria-label="Resolver automaticamente">
                    <div class="maintenance-choice-head">
                        <span class="maintenance-choice-icon">A</span>
                        <h3>Resolver lo seguro primero</h3>
                    </div>
                    <p>La app une solo los casos claros y te deja revisar los dudosos antes de cambiar algo.</p>
                    <strong>Recomendado</strong>
                </div>

                <div class="choice-card manual-choice" role="button" tabindex="0" data-maint-action="manual-choice"
                     aria-label="Revisar manualmente">
                    <div class="maintenance-choice-head">
                        <span class="maintenance-choice-icon">M</span>
                        <h3>Revisar uno por uno</h3>
                    </div>
                    <p>Tú decides en cada ficha cuál perfil se conserva, cuáles se unen y cuáles cambian de número.</p>
                </div>
            </div>
        `;

        this.modal = new Modal({
            title: 'Saneamiento de Datos',
            subtitle: 'Resolución de conflictos y duplicados',
            content: content,
            size: 'medium'
        }).open();

        // Para los handlers inline del HTML
        window._maintenanceUI = this;
    }

    async handleAutoChoice() {
        this.modal.close();
        
        const confirm = await Modal.confirm({
            title: 'Resolución automática',
            message: `¿Deseas proceder con la resolución automática de los ${this.conflicts.length} conflictos? Se realizará un respaldo previo.`,
            confirmText: 'Sí, resolver',
            cancelText: 'Cancelar'
        });
        if (!confirm) return;

        try {
            // Backup previo (si hay Firebase)
            if (globalThis.createFirebaseSnapshot) await globalThis.createFirebaseSnapshot('pre-restore', 'pre-mantenimiento-auto');
            
            const result = await executeAutoRepair();

            // Si hay conflictos pendientes de reasignación, abrir el sub-modal
            if (result.pendingReassignments && result.pendingReassignments.length > 0) {
                this.conflicts = result.pendingReassignments;
                this.currentConflictIndex = 0;
                this.mergeCount = 0;
                this.showReassignmentStep();
            }
        } catch (e) {
            console.error(e);
            NotificationSystem.error('Error durante la reparación automática');
        }
    }

    handleManualChoice() {
        this.modal.close();
        this.currentConflictIndex = 0;
        this.mergeCount = 0;
        this.showWizardStep();
    }

    /**
     * Muestra el paso actual del asistente manual (fusión)
     */
    showWizardStep() {
        const group = this.conflicts[this.currentConflictIndex];
        if (!group) {
            this.showCompletionScreen();
            return;
        }

        const content = this.renderWizardContent(group);
        
        if (this.modal && this.modal.isOpen) {
            this.modal.updateContent(content);
            this.modal.title = `Resolución Manual (${this.currentConflictIndex + 1} de ${this.conflicts.length})`;
        } else {
            this.modal = new Modal({
                title: `Resolución Manual (${this.currentConflictIndex + 1} de ${this.conflicts.length})`,
                subtitle: `Ficha repetida: ${group.number}`,
                content: content,
                size: 'large'
            }).open();
        }
    }

    renderWizardContent(group) {
        // Validación en vivo del estado actual del grupo.
        const validation = validateManualGroup(group.members);

        const validationBanner = validation.ok
            ? `<div class="maintenance-feedback maintenance-feedback-ok">
                  Listo para aplicar: ${validation.absorbIds.length} registro${validation.absorbIds.length === 1 ? '' : 's'} se unir${validation.absorbIds.length === 1 ? 'á' : 'án'} al perfil principal y ${validation.separateIds.length} persona${validation.separateIds.length === 1 ? '' : 's'} cambiar${validation.separateIds.length === 1 ? 'á' : 'án'} de ficha.
               </div>`
            : validation.errors.length > 0
                ? `<div class="maintenance-feedback maintenance-feedback-warn">
                      ${validation.errors.join(' ')}
                   </div>`
                : '';

        const colsCount = Math.min(group.members.length, 3);

        return `
            <div class="wizard-container maintenance-wizard">
                <section class="maintenance-guide" aria-label="Guía de decisiones">
                    <div class="maintenance-guide-header">
                        <span class="maintenance-kicker">Ficha repetida ${group.number}</span>
                        <h3>Decide qué hacer con cada registro</h3>
                        <p>Elige una acción para cada tarjeta. Si dos tarjetas son la misma persona, conserva una y une las demás. Si una tarjeta pertenece a otra persona, cámbiale la ficha.</p>
                    </div>
                    <div class="maintenance-decision-grid">
                        <div class="maintenance-decision-item">
                            <span class="maintenance-decision-mark master">1</span>
                            <div>
                                <strong>Conservar este perfil</strong>
                                <span>El perfil principal que queda al final.</span>
                            </div>
                        </div>
                        <div class="maintenance-decision-item">
                            <span class="maintenance-decision-mark absorb">2</span>
                            <div>
                                <strong>Unir con el principal</strong>
                                <span>Para duplicados de la misma persona.</span>
                            </div>
                        </div>
                        <div class="maintenance-decision-item">
                            <span class="maintenance-decision-mark separate">3</span>
                            <div>
                                <strong>Cambiar ficha</strong>
                                <span>Para alguien distinto que comparte el número por error.</span>
                            </div>
                        </div>
                    </div>
                </section>

                ${validationBanner}

                <div class="comparison-grid maintenance-compare-grid" style="grid-template-columns: repeat(${colsCount}, minmax(0, 1fr));">
                    ${group.members.map(emp => this.renderEmployeeCard(emp, group.number)).join('')}
                </div>

                <div class="maintenance-actions">
                    <button type="button" class="maintenance-apply-btn" data-maint-action="apply-manual-group"
                            ${validation.ok ? '' : 'disabled'}
                            aria-disabled="${validation.ok ? 'false' : 'true'}">
                        ${validation.ok ? 'Aplicar estas decisiones' : 'Selecciona una acción en cada tarjeta'}
                    </button>
                </div>
            </div>
        `;
    }

    renderEmployeeCard(emp, groupNumber) {
        const group = this.conflicts[this.currentConflictIndex];
        const role = emp.role || null;

        // Estados visuales por rol seleccionado.
        const ROLE_STYLES = {
            master:   { label: 'Perfil principal', description: 'Se conserva', className: 'is-master' },
            absorb:   { label: 'Se unirá', description: 'Misma persona', className: 'is-absorb' },
            separate: { label: 'Cambiar ficha', description: 'Otra persona', className: 'is-separate' },
            delete:   { label: 'Se eliminará', description: 'Registro de más', className: 'is-delete' }
        };
        const style = ROLE_STYLES[role] || { label: 'Sin decidir', description: 'Elige una acción', className: '' };

        const isMostComplete = emp.completeness === Math.max(...group.members.map(m => m.completeness || 0));
        const hasMoreAttendance = emp.attendanceCount === Math.max(...group.members.map(m => m.attendanceCount || 0));

        // Si el rol es separate, mostrar input inline para escribir la nueva
        // ficha (antes era window.prompt — UX cortante y rompe el flujo).
        const reassignBlock = role === 'separate'
            ? `
                <div class="maintenance-reassign-input-wrap" role="group" aria-label="Nueva ficha para este empleado">
                    <label for="reassign-input-${emp.id}">Nueva ficha:</label>
                    <input type="text"
                           id="reassign-input-${emp.id}"
                           class="maintenance-reassign-input"
                           value="${emp._reassignTo || ''}"
                           placeholder="Nro. de ficha"
                           data-id="${emp.id}"
                           autocomplete="off"
                           inputmode="numeric">
                    <button type="button"
                            class="maintenance-reassign-confirm"
                            data-maint-action="commit-reassign-ficha"
                            data-id="${emp.id}"
                            title="Confirmar nueva ficha (Enter)">
                        Confirmar
                    </button>
                </div>
            `
            : '';

        const btn = (action, label, helper, dataRole) => `
            <button type="button" class="maintenance-role-btn ${role === dataRole ? 'is-selected' : ''}" data-maint-action="${action}"
                    data-id="${emp.id}" data-role="${dataRole}"
                    data-role-choice="${dataRole}"
                    aria-pressed="${role === dataRole ? 'true' : 'false'}">
                <span>${label}</span>
                <small>${helper}</small>
            </button>
        `;

        // Tag de origen (local/cloud/both)
        const srcTag = emp._source
            ? `<span class="maintenance-source-tag ${emp._source === 'cloud' ? 'is-cloud' : emp._source === 'both' ? 'is-both' : 'is-local'}">${emp._source === 'cloud' ? 'Nube' : emp._source === 'both' ? 'Local y nube' : 'Local'}</span>`
            : '';

        // Badge de formato de id — display-only. Ayuda al usuario a distinguir
        // de un vistazo cuál registro viene del sistema legacy (UUID) vs el
        // actual (EMP{timestamp}). NO afecta identidad ni rutas — el id es
        // siempre inmutable; el formato es solo metadata visual.
        const formatClass = classifyEmployeeId(emp.id); // emp-modern | emp-seed | emp-legacy | emp-unknown
        const formatTag = `<span class="maintenance-format-tag is-${formatClass}" title="Formato del id: ${formatClass}">${idFormatLabel(emp.id)}</span>`;

        return `
            <div class="emp-compare-card maintenance-employee-card ${style.className}">
                <div class="maintenance-role-status">
                    <strong>${style.label}</strong>
                    <span>${style.description}</span>
                </div>

                <div class="maintenance-employee-head">
                    <div class="maintenance-avatar">
                        ${(emp.name || '?').split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase()}
                    </div>
                    <h4>${emp.name || '(sin nombre)'}</h4>
                    <div class="maintenance-meta-row">
                        <span class="maintenance-id-tag" title="ID completo: ${emp.id || ''}">ID ${emp.id || '(sin id)'}</span>
                        ${formatTag}
                        ${srcTag}
                    </div>
                    ${reassignBlock}
                </div>

                <div class="maintenance-stats">
                    <div>
                        <span>Asistencias</span>
                        <strong class="${hasMoreAttendance ? 'is-highlight' : ''}">${emp.attendanceCount || 0}</strong>
                    </div>
                    <div>
                        <span>Préstamos</span>
                        <strong>${(emp.loans || []).length}</strong>
                    </div>
                    <div>
                        <span>Datos del perfil</span>
                        <strong class="${isMostComplete ? 'is-highlight' : ''}">${emp.completeness || 0}%</strong>
                    </div>
                </div>

                <div class="maintenance-role-actions">
                    ${btn('set-member-role', 'Conservar', 'perfil principal', 'master')}
                    ${btn('set-member-role', 'Unir con este', 'es la misma persona', 'absorb')}
                    ${btn('set-member-role', 'Cambiar ficha', 'es otra persona', 'separate')}
                    ${btn('set-member-role', 'Eliminar', 'registro de más (se borra)', 'delete')}
                </div>
            </div>
        `;
    }

    /**
     * Asigna un rol a un miembro del grupo actual. Si el rol es 'master',
     * desmarca cualquier otro master del mismo grupo. Si es 'separate',
     * abre un sub-modal para pedir el nuevo número de ficha (Tarea #23).
     */
    setMemberRole(memberId, role) {
        const group = this.conflicts[this.currentConflictIndex];
        if (!group) return;
        const member = group.members.find(m => m.id === memberId);
        if (!member) return;

        // Toggle: clic en el mismo rol que ya tenía lo des-asigna.
        if (member.role === role) {
            member.role = null;
            member._reassignTo = null;
        } else {
            // Si pasa a master, los demás masters quedan sin rol.
            if (role === 'master') {
                group.members.forEach(m => {
                    if (m.id !== memberId && m.role === 'master') m.role = null;
                });
            }
            member.role = role;
            if (role !== 'separate') member._reassignTo = null;
        }

        // Re-render. El input inline de la card permite escribir la nueva
        // ficha sin abrir un prompt() del navegador (ver renderEmployeeCard).
        this.showWizardStep();

        // UX: si pasó a 'separate', enfocar el input recién renderizado.
        if (role === 'separate' && member.role === 'separate') {
            queueMicrotask(() => {
                const input = typeof document !== 'undefined'
                    && document.getElementById(`reassign-input-${memberId}`);
                if (input && typeof input.focus === 'function') {
                    input.focus();
                    input.select?.();
                }
            });
        }
    }

    /**
     * Lee el valor del input inline para el miembro dado, valida y guarda
     * en member._reassignTo. Re-renderiza para que la card refleje el
     * nuevo valor y el botón "Aplicar" se habilite si todas las decisiones
     * son consistentes.
     *
     * Validaciones:
     *   - No vacío.
     *   - No igual al número de la ficha actual del grupo (no tiene sentido
     *     "reasignarse a sí mismo").
     *   - No igual al _reassignTo de otro miembro 'separate' del mismo grupo.
     *
     * Permitir colisiones contra empleados FUERA del grupo es intencional
     * (ver reassignEmployeeNumber con allowCollision:true): si chocan, la
     * cascada de re-análisis los detectará como un nuevo grupo manual.
     */
    commitReassignFicha(memberId) {
        const group = this.conflicts[this.currentConflictIndex];
        if (!group) return;
        const member = group.members.find(m => m.id === memberId);
        if (!member) return;

        const input = typeof document !== 'undefined'
            && document.getElementById(`reassign-input-${memberId}`);
        if (!input) return;

        const raw = String(input.value || '').trim();
        if (!raw) {
            NotificationSystem.error('Escribe el número de la nueva ficha.');
            return;
        }
        if (String(raw) === String(group.number)) {
            NotificationSystem.error('La nueva ficha no puede ser la misma que la actual.');
            return;
        }
        const used = new Set(
            group.members
                .filter(m => m.id !== memberId && m.role === 'separate' && m._reassignTo)
                .map(m => String(m._reassignTo))
        );
        if (used.has(raw)) {
            NotificationSystem.error(`La ficha ${raw} ya está siendo usada por otro miembro de este grupo. Elige otra.`);
            return;
        }

        member._reassignTo = raw;
        this.showWizardStep();
    }

    /**
     * Sub-modal: pide el nuevo número de ficha para un miembro 'separate'.
     * Validaciones:
     *   - No vacío.
     *   - No igual al número actual del grupo.
     *   - No igual a otro miembro 'separate' del mismo grupo (consistencia).
     */
    promptReassignFicha(memberId) {
        const group = this.conflicts[this.currentConflictIndex];
        const member = group.members.find(m => m.id === memberId);
        if (!member) return;

        const used = new Set(
            group.members
                .filter(m => m.id !== memberId && m.role === 'separate' && m._reassignTo)
                .map(m => m._reassignTo)
        );
        used.add(group.number); // No puede ser el mismo que el grupo actual

        const newNumber = (typeof window !== 'undefined' && window.prompt)
            ? window.prompt(`Reasignar "${member.name}" — ¿a qué número de ficha pertenece?`, member._reassignTo || '')
            : null;

        if (newNumber === null || newNumber === undefined || String(newNumber).trim() === '') {
            // Usuario canceló: revertimos el rol.
            member.role = null;
            this.showWizardStep();
            return;
        }
        const clean = String(newNumber).trim();
        if (used.has(clean)) {
            NotificationSystem.error(`La ficha ${clean} ya está siendo usada en este grupo. Elige otra.`);
            member.role = null;
            this.showWizardStep();
            return;
        }
        member._reassignTo = clean;
        this.showWizardStep();
    }

    /**
     * Aplica las decisiones del grupo manual actual: fusiona los
     * 'absorb' en el master, reasigna las fichas de los 'separate',
     * guarda, y re-analiza por si las reasignaciones generaron nuevos
     * conflictos en otras fichas (cascada).
     *
     * Caso real: ficha 501 con Hector + Héctor + Jean. Resuelves
     * fusionando los dos Hector y reasignando Jean a la ficha 500.
     * Si en la 500 ya había otro Jean, aparece un nuevo grupo al
     * final de la cola para resolver a continuación.
     */
    /**
     * Feature #2: valida y confirma los borrados del wizard antes de aplicar.
     * - Bloquea (y avisa) si algún registro a eliminar tiene saldo pendiente.
     * - Advierte qué asistencia/préstamos se perderán y pide confirmación.
     * @returns {Promise<boolean>} true si se puede proceder.
     */
    async _confirmDuplicateDeletes(deleteIds, group) {
        const members = deleteIds
            .map(id => (group.members || []).find(m => m.id === id))
            .filter(Boolean);

        // Guard de saldo (proteger la plata) — bloquea todo el apply.
        for (const m of members) {
            const check = canDeleteDuplicateEmployee(m);
            if (!check.ok) {
                NotificationSystem.error(`No se puede eliminar "${m.name || m.id}": ${check.reason}`);
                return false;
            }
        }

        // Advertencia de datos que se pierden (asistencia / préstamos).
        const withData = members
            .map(m => ({
                name: m.name || '(sin nombre)',
                att: m.attendanceCount || 0,
                loans: (m.loans || []).length
            }))
            .filter(x => x.att > 0 || x.loans > 0);

        const lines = members.map(m => `• ${escapeHTML(m.name || '(sin nombre)')}`).join('<br>');
        let message = `Vas a ELIMINAR de forma permanente ${members.length} registro${members.length === 1 ? '' : 's'}:<br>${lines}<br><br>`;
        if (withData.length > 0) {
            const dataLines = withData
                .map(x => `• ${escapeHTML(x.name)}: ${x.att} asistencia${x.att === 1 ? '' : 's'}, ${x.loans} préstamo${x.loans === 1 ? '' : 's'}`)
                .join('<br>');
            message += `⚠️ Se PERDERÁN estos datos:<br>${dataLines}<br><br>` +
                `Si querés conservarlos, cancelá y usá "Unir con el principal" en vez de "Eliminar".<br><br>`;
        }
        message += `El borrado se propaga a todos tus dispositivos. ¿Continuar?`;

        return Modal.confirm({
            title: 'Eliminar registros duplicados',
            message,
            confirmText: 'Sí, eliminar',
            cancelText: 'Cancelar',
            type: 'danger'
        });
    }

    async applyManualGroup() {
        const group = this.conflicts[this.currentConflictIndex];
        if (!group) return;

        const validation = validateManualGroup(group.members);
        if (!validation.ok) {
            NotificationSystem.error('Faltan decisiones: ' + validation.errors.join(' '));
            return;
        }

        const { masterId, absorbIds, separateIds, deleteIds } = validation;

        // Feature #2: confirmar los borrados ANTES de ejecutar nada. Bloquea si
        // algún registro a eliminar tiene saldo pendiente (proteger la plata);
        // avisa si se perderán asistencia/préstamos.
        if (deleteIds && deleteIds.length > 0) {
            const proceed = await this._confirmDuplicateDeletes(deleteIds, group);
            if (!proceed) return;
        }

        // 1. Fusionar absorbs en el master usando executeMergePlan (que ya
        //    sabe manejar cloud-only y encolar borrados remotos).
        if (masterId && absorbIds.length > 0) {
            const planItem = {
                number: group.number,
                action: 'auto-merge',
                members: group.members,
                proposedMasterId: masterId,
                loserIds: absorbIds,
                totalLoansAfterMerge: 0,
                hasCloudLosers: group.members.some(m =>
                    absorbIds.includes(m.id) && (m._source === 'cloud' || m._source === 'both')
                )
            };
            const r = executeMergePlan([planItem]);
            this.mergeCount += (r.merged || 0);
        }

        // 1.b Feature #2: ejecutar los tombstones de los eliminados. Robusto
        //     (soft-delete): el borrado sobrevive al multi-dispositivo. Se saca
        //     de state ANTES del save (paso 3) para que el snapshot no los
        //     re-suba, y se encola el tombstone durable con el ts del borrado.
        if (deleteIds && deleteIds.length > 0) {
            const now = Date.now();
            stateManager.batchSetState(() => {
                state.employees = state.employees.filter(e => !deleteIds.includes(e.id));
            });
            for (const delId of deleteIds) {
                enqueueEmployeeTombstone(delId, now);
            }
        }

        // 2. Reasignar separates. Materializar miembros cloud-only antes.
        for (const sepId of separateIds) {
            const member = group.members.find(m => m.id === sepId);
            if (!member || !member._reassignTo) continue;

            const inState = state.employees.find(e => e.id === sepId);
            if (!inState) {
                const copy = { ...member };
                delete copy._source;
                delete copy._reassignTo;
                delete copy.role;
                state.employees.push(copy);
            }
            // allowCollision:true — si el destino ya está ocupado, dejamos el
            // conflicto temporal en pie y la re-detección de abajo lo añadirá
            // como un nuevo grupo manual a la cola del wizard.
            reassignEmployeeNumber(sepId, member._reassignTo, { allowCollision: true });
        }

        // 3. Guardar. saveApplicationData también drena _pendingCloudDeletes
        //    (Tarea #18) y sube los empleados cuyo número cambió.
        await saveApplicationData({ skipValidation: false, clearAttendance: true });

        // 4. Re-analizar: cargar cloud para ver si las reasignaciones
        //    crearon conflictos nuevos en otras fichas.
        let cloudEmployees = [];
        const isMigrated = (typeof state.settings?.schemaVersion === 'number') && state.settings.schemaVersion >= 2;
        const hasUser = typeof globalThis !== 'undefined' && !!globalThis.currentUser;
        if (isMigrated && hasUser) {
            try {
                // M1: null ante fallo de lectura → conservar [] para el análisis
                cloudEmployees = (await EmployeeRepository.loadAll()) || [];
            } catch (e) {
                console.warn('⚠️ Re-análisis: no se pudo leer cloud:', e);
            }
        }
        const fresh = analyzeConflicts({ cloudEmployees });

        // 5. Reconstruir la cola: mantener los grupos ya procesados,
        //    descartar los que reaparecen ya resueltos, y añadir los
        //    nuevos (probablemente generados por las reasignaciones).
        const processedNumbers = new Set(
            this.conflicts
                .slice(0, this.currentConflictIndex + 1)
                .map(c => String(c.number))
        );
        const remaining = fresh.filter(c => !processedNumbers.has(String(c.number)));

        this.conflicts = [
            ...this.conflicts.slice(0, this.currentConflictIndex + 1),
            ...remaining
        ];

        // 6. Avanzar al siguiente grupo del wizard.
        this.currentConflictIndex++;
        this.showWizardStep();
    }

    /**
     * Fusiona duplicados en el maestro elegido.
     * Acumula cambios y guarda UNA sola vez al final del wizard.
     */
    async resolveConflict(masterId) {
        const group = this.conflicts[this.currentConflictIndex];
        const duplicates = group.members.filter(m => m.id !== masterId);

        for (const dup of duplicates) {
            if (mergeEmployees(masterId, dup.id)) {
                this.mergeCount++;
            }
        }

        // ⚡ TRUCO DE LA ARENA: Asegurar que el ganador se quede con el número del grupo 
        // (Relevante si fue un grupo "virtual" forzado de cruzamiento de fichas ajenas)
        const master = state.employees.find(e => e.id === masterId);
        if (master && master.number !== group.number) {
            reassignEmployeeNumber(masterId, group.number);
        }


        NotificationSystem.success(`✅ Unificado en el perfil maestro.`);
        
        this.currentConflictIndex++;
        this.showWizardStep();
    }

    /**
     * "Omitir" → Abre el sub-modal de reasignación de ficha
     */
    skipStep() {
        this.showReassignmentStep();
    }

    // ═══════════════════════════════════
    // SUB-MODAL DE REASIGNACIÓN DE FICHA
    // ═══════════════════════════════════

    /**
     * Muestra la pantalla de reasignación de ficha para el conflicto actual
     */
    showReassignmentStep() {
        const group = this.conflicts[this.currentConflictIndex];
        if (!group) {
            this.showCompletionScreen();
            return;
        }

        const content = this.renderReassignmentContent(group);

        if (this.modal && this.modal.isOpen) {
            this.modal.updateContent(content);
            this.modal.title = `Reasignación de Ficha (${this.currentConflictIndex + 1} de ${this.conflicts.length})`;
        } else {
            this.modal = new Modal({
                title: `Reasignación de Ficha (${this.currentConflictIndex + 1} de ${this.conflicts.length})`,
                subtitle: `Ficha en conflicto: ${group.number}`,
                content: content,
                size: 'large'
            }).open();
        }

        // Configurar validación en tiempo real de los inputs
        this.setupReassignmentValidation(group);
    }

    renderReassignmentContent(group) {
        // Sugerir el siguiente número disponible
        const maxNum = Math.max(0, ...state.employees.map(e => parseInt(e.number) || 0));
        const suggestedNumber = String(maxNum + 1).padStart(3, '0');

        return `
            <div class="reassignment-container" style="display: flex; flex-direction: column; gap: 20px;">
                <div style="background: rgba(234, 179, 8, 0.08); border: 1px solid rgba(234, 179, 8, 0.2); border-radius: 10px; padding: 14px;">
                    <p style="color: #eab308; margin: 0; font-size: 0.85rem; font-weight: 600;">
                        ⚠️ Estos empleados comparten el número <strong>${group.number}</strong> pero son personas distintas.
                    </p>
                    <p style="color: #94a3b8; margin: 6px 0 0; font-size: 0.8rem;">
                        Cambia el número de al menos uno para resolver el conflicto. Sugerido: <strong style="color: #22c55e;">${suggestedNumber}</strong>
                    </p>
                </div>

                <div class="reassign-grid" style="display: grid; grid-template-columns: repeat(${Math.min(group.members.length, 3)}, 1fr); gap: 15px;">
                    ${group.members.map((emp, idx) => this.renderReassignmentCard(emp, group.number, suggestedNumber, idx)).join('')}
                </div>

                <div id="reassign-error" style="display: none; color: #f43f5e; font-size: 0.8rem; text-align: center; padding: 8px;"></div>

                <div style="display: flex; justify-content: center; gap: 12px; margin-top: 10px; flex-wrap: wrap;">
                    <button class="btn-ghost" type="button" data-maint-action="skip-reassignment" style="color: #64748b; padding: 10px;">Omitir sin cambios</button>
                    <button class="btn-ghost" type="button" data-maint-action="force-comparison" style="color: #3b82f6; padding: 10px;">Son la misma persona (Comparar)</button>
                    <button class="btn-primary" id="btn-apply-reassign" type="button" data-maint-action="apply-reassignment" style="padding: 10px 24px;" disabled>
                        💾 Aplicar Cambios
                    </button>
                </div>
            </div>
        `;
    }

    renderReassignmentCard(emp, originalNumber, suggestedNumber, index) {
        const hasMoreAttendance = emp.attendanceCount === Math.max(...this.conflicts[this.currentConflictIndex].members.map(m => m.attendanceCount));

        return `
            <div class="reassign-card" style="background: #0f172a; border: 1px solid #1e293b; border-radius: 12px; padding: 15px; display: flex; flex-direction: column; gap: 12px;">
                <div style="text-align: center;">
                    <div style="width: 50px; height: 50px; background: #1e293b; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 10px; color: #f8fafc; font-weight: bold;">
                        ${emp.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase()}
                    </div>
                    <h4 style="margin: 0; color: #f8fafc; font-size: 1rem;">${emp.name}</h4>
                </div>

                <div style="display: flex; flex-direction: column; gap: 6px; font-size: 0.8rem; padding: 8px; background: #020617; border-radius: 8px;">
                    <div style="display: flex; justify-content: space-between;">
                        <span style="color: #64748b;">📍 Asistencias:</span>
                        <span style="color: ${hasMoreAttendance ? '#22c55e' : '#f8fafc'}; font-weight: bold;">${emp.attendanceCount}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between;">
                        <span style="color: #64748b;">📅 Última:</span>
                        <span style="color: #f8fafc;">${emp.lastAttendance}</span>
                    </div>
                </div>

                <div style="margin-top: auto; padding-top: 8px;">
                    <label style="font-size: 0.7rem; color: #64748b; display: block; margin-bottom: 6px; font-weight: 600;">
                        🔢 Número de ficha:
                    </label>
                    <input type="text" 
                           class="form-input reassign-number-input" 
                           data-emp-id="${emp.id}" 
                           data-original="${originalNumber}"
                           value="${originalNumber}" 
                           placeholder="${suggestedNumber}"
                           maxlength="10"
                           style="font-size: 0.9rem; text-align: center; padding: 8px; font-weight: 700;">
                    <div class="reassign-status" data-emp-id="${emp.id}" 
                         style="font-size: 0.7rem; margin-top: 4px; text-align: center; min-height: 1.2em; color: #64748b;">
                        Sin cambios
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Configura validación en tiempo real para los inputs de reasignación
     */
    setupReassignmentValidation(group) {
        const container = this.modal.element;
        if (!container) return;

        // Debounce para no validar en cada tecla
        let validationTimer;
        container.querySelectorAll('.reassign-number-input').forEach(input => {
            input.addEventListener('input', () => {
                clearTimeout(validationTimer);
                validationTimer = setTimeout(() => this.validateReassignment(group), 200);
            });
        });
    }

    /**
     * Valida el estado de todos los inputs de reasignación
     */
    validateReassignment(group) {
        const container = this.modal.element;
        if (!container) return;

        const inputs = container.querySelectorAll('.reassign-number-input');
        const btnApply = container.querySelector('#btn-apply-reassign');
        const errorDiv = container.querySelector('#reassign-error');
        
        let hasChange = false;
        let hasError = false;
        const newNumbers = new Map(); // Para detectar colisiones entre los inputs

        inputs.forEach(input => {
            const empId = input.dataset.empId;
            const original = input.dataset.original;
            const newVal = input.value.trim();
            const statusDiv = container.querySelector(`.reassign-status[data-emp-id="${empId}"]`);

            if (!newVal) {
                statusDiv.textContent = '❌ Requerido';
                statusDiv.style.color = '#f43f5e';
                input.style.borderColor = '#f43f5e';
                hasError = true;
                return;
            }

            if (newVal === original) {
                statusDiv.textContent = 'Sin cambios';
                statusDiv.style.color = '#64748b';
                input.style.borderColor = '';
                return;
            }

            hasChange = true;

            // Verificar colisión con otros empleados fuera del grupo
            const conflictEmp = state.employees.find(e => 
                e.number === newVal && 
                !group.members.some(m => m.id === e.id)
            );

            if (conflictEmp) {
                statusDiv.textContent = `⚠️ Compartirá con: ${conflictEmp.name}`;
                statusDiv.style.color = '#eab308';
                input.style.borderColor = '#eab308';
                // Solo advierte, no bloquea (permite al usuario forzar el encadenamiento de conflictos)
                return;
            }

            // Verificar colisión entre los inputs del grupo
            if (newNumbers.has(newVal)) {
                statusDiv.textContent = '❌ Duplicado dentro del grupo';
                statusDiv.style.color = '#f43f5e';
                input.style.borderColor = '#f43f5e';
                hasError = true;
                return;
            }

            newNumbers.set(newVal, empId);
            statusDiv.textContent = '✅ Disponible';
            statusDiv.style.color = '#22c55e';
            input.style.borderColor = '#22c55e';
        });

        // Los que no cambiaron deben verificar que no colisionan entre sí
        // (esto se maneja implícitamente: si ambos quedan con el mismo número = error)
        const allValues = Array.from(inputs).map(i => i.value.trim());
        const uniqueValues = new Set(allValues);
        if (uniqueValues.size < allValues.length) {
            hasError = true;
            if (errorDiv) {
                errorDiv.style.display = 'block';
                errorDiv.textContent = '⚠️ Al menos uno debe tener un número diferente para resolver el conflicto.';
            }
        } else {
            if (errorDiv) errorDiv.style.display = 'none';
        }

        if (btnApply) {
            btnApply.disabled = hasError || !hasChange;
        }
    }

    async applyReassignment() {
        const container = this.modal.element;
        if (!container) return;

        const inputs = container.querySelectorAll('.reassign-number-input');
        let changesMade = 0;
        let createdVirtualConflict = null;
        let group = this.conflicts[this.currentConflictIndex];

        // 1. Efectuar reasignaciones pacíficas y buscar la primera cruzada transicional
        for (const input of Array.from(inputs)) {
            const empId = input.dataset.empId;
            const original = input.dataset.original;
            const newVal = input.value.trim();

            if (newVal && newVal !== original) {
                const emp = group.members.find(m => m.id === empId);
                const conflictEmpRaw = state.employees.find(e => e.number === newVal && !group.members.some(m => m.id === e.id));

                if (conflictEmpRaw) {
                    // Calculamos los metadatos de completeness/attendance de conflictEmpRaw para que el Visualizador no explote
                    const idPrefix = `${conflictEmpRaw.id}-`;
                    // Fase 1 (U2c): un tombstone no cuenta como asistencia real.
                    const attendanceKeys = Object.entries(state.attendance || {})
                        .filter(([k, v]) => k.startsWith(idPrefix) && v.deletedAt == null)
                        .map(([k]) => k);

                    let lastDate = 'Nunca';
                    if (attendanceKeys.length > 0) {
                        const sortedDates = attendanceKeys.map(k => k.substring(idPrefix.length)).sort();
                        lastDate = sortedDates[sortedDates.length - 1];
                    }
                    const fields = ['phone', 'email', 'salary', 'dailyRate', 'entryDate'];
                    const filled = fields.filter(f => conflictEmpRaw[f] && conflictEmpRaw[f] !== '').length;
                    
                    const enrichedConflictEmp = {
                        ...conflictEmpRaw,
                        attendanceCount: attendanceKeys.length,
                        lastAttendance: lastDate,
                        completeness: Math.round((filled / fields.length) * 100)
                    };

                    // Creamos el Virtual Group forzando el choque.
                    createdVirtualConflict = {
                        number: newVal,
                        members: [emp, enrichedConflictEmp]
                    };
                    break; // Solo soportamos 1 salto virtual a la vez para mantener el flujo UI estable
                } else {
                    if (reassignEmployeeNumber(empId, newVal)) {
                        changesMade++;
                    }
                }
            }
        }

        if (changesMade > 0) {
            NotificationSystem.success(`🔄 ${changesMade} ficha(s) reasignada(s) pacíficamente.`);
        }

        if (createdVirtualConflict) {
            // El usuario forzó un enfrentamiento.
            // 1. Borrar el grupo actual de la lista (ya lo deshicimos reasignando a los demás y cruzando a este).
            this.conflicts.splice(this.currentConflictIndex, 1);
            // 2. Inyectar el grupo virtual en esta misma posición para abrirlo enseguida
            this.conflicts.splice(this.currentConflictIndex, 0, createdVirtualConflict);
            
            NotificationSystem.info(`⚔️ Has cruzado a dos identidades. Resolución visual requerida.`);
            this.showWizardStep();
            return;
        }

        this.currentConflictIndex++;
        if (this.currentConflictIndex < this.conflicts.length) {
            this.showReassignmentStep();
        } else {
            this.showCompletionScreen();
        }
    }

    /**
     * Forzar la resolución visual asumiendo que los empleados distintos SON en realidad la misma persona.
     */
    forceComparison() {
        this.showWizardStep();
    }



    /**
     * Omitir la reasignación sin cambios
     */
    skipReassignment() {
        this.currentConflictIndex++;
        if (this.currentConflictIndex < this.conflicts.length) {
            this.showReassignmentStep();
        } else {
            this.showCompletionScreen();
        }
    }

    // ═══════════════════════════════════
    // PANTALLA DE FINALIZACIÓN
    // ═══════════════════════════════════

    async showCompletionScreen() {
        // Guardar todos los cambios acumulados (fusiones + reasignaciones) de una vez
        if (this.mergeCount > 0) {
            await saveApplicationData({ skipValidation: false, clearAttendance: true });
        } else {
            await saveApplicationData({ skipValidation: false });
        }

        if (this.modal) this.modal.close();
        NotificationSystem.success('🏁 Asistente de mantenimiento finalizado.');
        if (globalThis.render) globalThis.render();
    }
}

// Exportar helper para global
window.startMaintenanceWizard = async () => {
    const ui = new MaintenanceUI();
    await ui.start();
};
