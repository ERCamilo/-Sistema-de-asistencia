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
import { state } from '../core/AppState.js';
import { Notification as NotificationSystem } from '../components/Notification.js';

export class MaintenanceUI {
    constructor() {
        this.conflicts = [];
        this.currentConflictIndex = 0;
        this.modal = null;
        this.mergeCount = 0; // Acumulador de fusiones pendientes de guardar
    }

    /**
     * Inicia el proceso de mantenimiento buscando conflictos
     */
    async start() {
        this.conflicts = analyzeConflicts();
        
        if (this.conflicts.length === 0) {
            NotificationSystem.info('✨ No se encontraron duplicados que requieran atención.');
            return;
        }

        this.showSelectionModal();
    }

    /**
     * Muestra el modal inicial para elegir entre Auto y Manual
     */
    showSelectionModal() {
        const content = `
            <div class="maintenance-selection" style="display: flex; flex-direction: column; gap: 20px; padding: 10px;">
                <p style="color: #94a3b8; margin-bottom: 5px;">Se han detectado <strong>${this.conflicts.length} grupos</strong> de empleados con números de ficha duplicados.</p>
                
                <div class="choice-card auto-choice" onclick="window._maintenanceUI.handleAutoChoice()" 
                     style="padding: 20px; border: 1px solid #1e293b; border-radius: 12px; cursor: pointer; background: #0f172a; transition: all 0.2s;">
                    <div style="display: flex; align-items: center; gap: 15px; margin-bottom: 8px;">
                        <span style="font-size: 1.5rem;">⚡</span>
                        <h3 style="margin: 0; color: #f8fafc;">Resolución Automática</h3>
                    </div>
                    <p style="font-size: 0.85rem; color: #64748b; margin: 0;">El sistema elegirá automáticamente el mejor registro basado en el historial de asistencia y completitud del perfil. Si detecta personas distintas, te pedirá reasignar fichas. (Recomendado)</p>
                </div>

                <div class="choice-card manual-choice" onclick="window._maintenanceUI.handleManualChoice()"
                     style="padding: 20px; border: 1px solid #1e293b; border-radius: 12px; cursor: pointer; background: #0f172a; transition: all 0.2s;">
                    <div style="display: flex; align-items: center; gap: 15px; margin-bottom: 8px;">
                        <span style="font-size: 1.5rem;">🔍</span>
                        <h3 style="margin: 0; color: #f8fafc;">Resolución Manual</h3>
                    </div>
                    <p style="font-size: 0.85rem; color: #64748b; margin: 0;">Tú comparas los perfiles y eliges qué registro conservar para cada caso. Ideal para casos ambiguos.</p>
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
            if (globalThis.createFirebaseSnapshot) await globalThis.createFirebaseSnapshot('pre-mantenimiento-auto');
            
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
        return `
            <div class="wizard-container" style="display: flex; flex-direction: column; gap: 20px;">
                <p style="color: #94a3b8; text-align: center;">Elige el perfil que deseas conservar como <strong>Maestro</strong>. El historial del resto se fusionará en él.</p>
                
                <div class="comparison-grid" style="display: grid; grid-template-columns: repeat(${Math.min(group.members.length, 3)}, 1fr); gap: 15px;">
                    ${group.members.map(emp => this.renderEmployeeCard(emp, group.number)).join('')}
                </div>
                
                <div style="display: flex; justify-content: center; margin-top: 10px;">
                    <button class="btn-ghost" onclick="window._maintenanceUI.skipStep()" style="color: #64748b;">Son personas distintas (Reasignar ficha)</button>
                </div>
            </div>
        `;
    }

    renderEmployeeCard(emp, groupNumber) {
        const group = this.conflicts[this.currentConflictIndex];
        const isMostComplete = emp.completeness === Math.max(...group.members.map(m => m.completeness));
        const hasMoreAttendance = emp.attendanceCount === Math.max(...group.members.map(m => m.attendanceCount));

        return `
            <div class="emp-compare-card" style="background: #0f172a; border: 1px solid #1e293b; border-radius: 12px; padding: 15px; display: flex; flex-direction: column; gap: 12px;">
                <div style="text-align: center;">
                    <div style="width: 50px; height: 50px; background: #1e293b; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 10px; color: #f8fafc; font-weight: bold;">
                        ${emp.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase()}
                    </div>
                    <h4 style="margin: 0; color: #f8fafc; font-size: 1rem;">${emp.name}</h4>
                    <span style="font-size: 0.75rem; color: #64748b; font-family: monospace;">ID: ${emp.id.substring(0, 8)}...</span>
                </div>

                <div class="emp-stats" style="display: flex; flex-direction: column; gap: 8px; font-size: 0.85rem; padding: 10px; background: #020617; border-radius: 8px;">
                    <div style="display: flex; justify-content: space-between;">
                        <span style="color: #64748b;">📍 Asistencias:</span>
                        <span style="color: ${hasMoreAttendance ? '#22c55e' : '#f8fafc'}; font-weight: bold;">${emp.attendanceCount}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between;">
                        <span style="color: #64748b;">📅 Última:</span>
                        <span style="color: #f8fafc;">${emp.lastAttendance}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between;">
                        <span style="color: #64748b;">📊 Datos:</span>
                        <span style="color: ${isMostComplete ? '#3b82f6' : '#f8fafc'}; font-weight: bold;">${emp.completeness}%</span>
                    </div>
                </div>

                <div class="emp-actions" style="margin-top: auto; padding-top: 10px;">
                    <button class="btn-primary" onclick="window._maintenanceUI.resolveConflict('${emp.id}')" style="width: 100%; padding: 10px; font-size: 0.8rem;">
                        CONSERVAR ESTE
                    </button>
                </div>
            </div>
        `;
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
                    <button class="btn-ghost" onclick="window._maintenanceUI.skipReassignment()" style="color: #64748b; padding: 10px;">Omitir sin cambios</button>
                    <button class="btn-ghost" onclick="window._maintenanceUI.forceComparison()" style="color: #3b82f6; padding: 10px;">Son la misma persona (Comparar)</button>
                    <button class="btn-primary" id="btn-apply-reassign" onclick="window._maintenanceUI.applyReassignment()" style="padding: 10px 24px;" disabled>
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
                    const attendanceKeys = Object.keys(state.attendance || {}).filter(k => k.startsWith(idPrefix));
                    
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
