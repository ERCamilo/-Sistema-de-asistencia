import { analyzeConflicts, saveApplicationData } from '../services/PersistenceService.js';
import { state } from '../core/AppState.js';
import { Modal } from './Modal.js';
import icons from '../ui/IconSystem.js';
import { isProjectsEnabled, isProjectDuplicatesEnabled } from '../config/FeatureFlags.js';
import { buildProjectPairReviews } from '../features/projects/ProjectDuplicateReview.js';
import { projectStore } from '../features/projects/ProjectStore.js';
import { protectedProjectIds } from '../features/projects/ProjectUsage.js';

// Obras repetidas: se recalcula como mucho cada 30 s en los repintados (los eventos del catálogo fuerzan).
const PROJECT_HEALTH_THROTTLE_MS = 30_000;
const PROJECT_HEALTH_DEBOUNCE_MS = 400;
const PROJECT_HEALTH_EVENTS = ['projects:setup-changed', 'projects:created', 'app:ready'];

async function loadProjectHealthData() {
    return {
        projects: await projectStore.listAll(),
        employees: state.employees || [],
        attendance: state.attendance || {},
        defaultProjectId: protectedProjectIds().defaultProjectId
    };
}

// ============================================
// 🎯 EVENT DELEGATION (data-alerts-action)
// ============================================
const _ALERTS_ACTION_MAP = {
    // El aviso abre directamente la pantalla «Duplicados» (sin diálogo previo).
    'show-resolution-dialog': () => window.startMaintenanceWizard?.(),
    'start-maintenance-from-alert': () => {
        if (window._systemAlerts?.currentModal) window._systemAlerts.currentModal.close();
        window.startMaintenanceWizard?.();
    },
    // Al cerrar la pantalla se recalcula: lo que se fusionó o descartó ya no cuenta.
    'show-project-duplicates': () => {
        const alerts = window._systemAlerts;
        window.openProjectDuplicatesScreen?.({ onClose: () => { void alerts?.refreshProjectHealth(); } });
    },
    'ignore-temporarily': () => window._systemAlerts?.ignoreTemporarily(),
    'ignore-permanently': () => window._systemAlerts?.ignorePermanently()
};

function _handleAlertsClick(e) {
    const target = e.target.closest('[data-alerts-action]');
    if (!target) return;
    const action = target.dataset.alertsAction;
    const handler = _ALERTS_ACTION_MAP[action];
    if (handler) handler();
}

let _alertsDelegationAttached = false;
if (!_alertsDelegationAttached) {
    document.addEventListener('click', _handleAlertsClick);
    _alertsDelegationAttached = true;
}

export class SystemAlertsManager {
    constructor({ projectDuplicates = {} } = {}) {
        this.sessionIgnored = false;
        this.currentConflicts = 0;
        this.projectPairs = 0;
        this._projectHealth = {
            isEnabled: projectDuplicates.isEnabled || (() => isProjectsEnabled() && isProjectDuplicatesEnabled()),
            load: projectDuplicates.load || loadProjectHealthData,
            now: projectDuplicates.now || Date.now,
            seq: 0, last: -Infinity, timer: null
        };
        this._onProjectEvent = () => {
            clearTimeout(this._projectHealth.timer);
            this._projectHealth.timer = setTimeout(() => { void this.refreshProjectHealth(); }, PROJECT_HEALTH_DEBOUNCE_MS);
        };
        if (typeof window !== 'undefined') PROJECT_HEALTH_EVENTS.forEach(name => window.addEventListener(name, this._onProjectEvent));
    }

    /** Quita los oyentes (solo para pruebas: en la app hay una única instancia). */
    dispose() {
        clearTimeout(this._projectHealth.timer);
        if (typeof window !== 'undefined') PROJECT_HEALTH_EVENTS.forEach(name => window.removeEventListener(name, this._onProjectEvent));
    }

    /** Recalcula solo si pasó el tiempo mínimo; pensado para llamarse en cada repintado. */
    scheduleProjectHealth() {
        const health = this._projectHealth;
        if (health.now() - health.last < PROJECT_HEALTH_THROTTLE_MS) return Promise.resolve(null);
        return this.refreshProjectHealth();
    }

    /**
     * Cuenta los pares de obras que parecen la misma. Nunca lanza: ante un fallo, cero.
     * Repinta solo si la cuenta cambió; un resultado viejo no pisa a uno más nuevo.
     */
    async refreshProjectHealth() {
        const health = this._projectHealth;
        const seq = ++health.seq;
        health.last = health.now();
        let count = 0;
        try {
            if (health.isEnabled()) count = buildProjectPairReviews(await health.load()).length;
        } catch (error) {
            console.warn('Obras repetidas: no se pudo comparar:', error?.message || error);
        }
        if (seq !== health.seq) return this.projectPairs;
        const changed = count !== this.projectPairs;
        this.projectPairs = count;
        if (changed) this.triggerUIUpdate();
        return count;
    }

    /**
     * Evalúa la salud del sistema (ej. duplicados).
     * Devuelve true si el Header debe re-renderizarse.
     */
    checkHealth() {
        const prevConflicts = this.currentConflicts;
        try {
            const conflicts = analyzeConflicts();
            this.currentConflicts = conflicts.length;
        } catch (error) {
            console.error('Error analizando conflictos:', error);
            this.currentConflicts = 0;
        }
        
        try { void this.scheduleProjectHealth(); } catch (_) { /* nunca rompe el repintado */ }

        return prevConflicts !== this.currentConflicts;
    }

    /**
     * Devuelve si la alerta específica de duplicados debe estar visible.
     */
    shouldShowDuplicateAlert() {
        if (this.currentConflicts === 0) return false;
        if (this.sessionIgnored) return false;
        if (state.settings?.hideDuplicateAlerts) return false;
        
        return true;
    }

    /**
     * Devuelve el HTML del botón de alerta para inyectar en el Header.
     */
    renderAlertButton() {
        return this.renderEmployeeAlertButton() + this.renderProjectAlertButton();
    }

    /** Aviso de obras repetidas: mismo estilo que el de empleados, abre «Obras repetidas». */
    renderProjectAlertButton() {
        const count = this.projectPairs;
        if (!count || !this._projectHealth.isEnabled()) return '';
        return `
            <button class="header-icon-btn warning-alert project-dup-alert" type="button" data-alerts-action="show-project-duplicates" aria-label="Obras repetidas: ${count} ${count === 1 ? 'posible' : 'posibles'}">
                ${icons.get('layers', { size: 20 }) || '🗂️'}
                <span class="project-dup-badge">${count}</span>
            </button>
        `;
    }

    renderEmployeeAlertButton() {
        if (!this.shouldShowDuplicateAlert()) return '';

        return `
            <button class="header-icon-btn warning-alert heartbeat" type="button" data-alerts-action="show-resolution-dialog" aria-label="Alertas del Sistema: Tienes duplicados">
                ${icons.get('alert', { size: 20 }) || '⚠️'}
                <span class="alert-badge">${this.currentConflicts}</span>
            </button>
        `;
    }

    /**
     * Ignora la advertencia hasta el próximo reinicio de la página.
     */
    ignoreTemporarily() {
        this.sessionIgnored = true;
        this.triggerUIUpdate();
        if (this.currentModal) this.currentModal.close();
    }

    /**
     * Oculta permanentemente la alerta modificando las settings.
     */
    ignorePermanently() {
        if (!state.settings) state.settings = {};
        state.settings.hideDuplicateAlerts = true;
        saveApplicationData();
        this.triggerUIUpdate();
        if (this.currentModal) this.currentModal.close();
    }

    /**
     * Devuelve la notificación persistente
     */
    reactivateAlerts() {
        if (!state.settings) state.settings = {};
        state.settings.hideDuplicateAlerts = false;
        this.sessionIgnored = false;
        saveApplicationData();
        this.triggerUIUpdate();
    }

    triggerUIUpdate() {
        if (window.render) {
            window.render();
        }
    }

    /**
     * Muestra el modal explicativo con claro enfoque al usuario.
     */
    showResolutionDialog() {
        const content = `
            <div class="system-alert-dialog" style="padding: 10px;">
                <div style="display: flex; align-items: center; gap: 15px; margin-bottom: 20px;">
                    <div style="color: #fbbf24; background: rgba(251, 191, 36, 0.1); padding: 12px; border-radius: 50%;">
                        ${icons.get('alert', { size: 32 }) || '⚠️'}
                    </div>
                    <div>
                        <h2 style="margin: 0; color: #f8fafc; font-size: 1.25rem;">Hemos detectado Registros Duplicados</h2>
                        <p style="margin: 5px 0 0 0; color: #94a3b8; font-size: 0.9rem;">Existen ${this.currentConflicts} grupos de empleados con números de ficha idénticos.</p>
                    </div>
                </div>

                <div style="background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.05); padding: 15px; border-radius: 8px; margin-bottom: 20px;">
                    <p style="margin: 0 0 10px 0; color: #cbd5e1; font-size: 0.95rem;">
                        <strong>¿Cómo me afecta esto?</strong><br>
                        Tener un mismo número de ficha asignado a varios empleados (o al mismo empleado repetido) 
                        divide su historial de asistencia y genera inconsistencias en nómina.
                    </p>
                    <p style="margin: 0; color: #cbd5e1; font-size: 0.95rem;">
                        Hemos preparado un asistente automático que puede fusionar historiales sin perder datos.
                    </p>
                </div>

                <div style="display: flex; flex-direction: column; gap: 10px;">
                    <button class="btn primary" type="button" data-alerts-action="start-maintenance-from-alert" style="width: 100%; justify-content: center; padding: 12px; font-size: 1rem;">
                        ✨ Iniciar Asistente de Solución Rápida
                    </button>
                    
                    <div style="display: flex; gap: 10px; margin-top: 5px;">
                        <button class="btn secondary" type="button" data-alerts-action="ignore-temporarily" style="flex: 1; justify-content: center; background: transparent; border: 1px solid #475569;">
                            Ignorar hasta reiniciar
                        </button>
                        <button class="btn secondary" type="button" data-alerts-action="ignore-permanently" style="flex: 1; justify-content: center; background: transparent; border: 1px solid #475569; color: #94a3b8;">
                            Nunca mostrar
                        </button>
                    </div>
                    <p style="text-align: center; margin: 10px 0 0 0; font-size: 0.75rem; color: #64748b;">
                        Puedes reactivar esta alerta desde los Ajustes Generales.
                    </p>
                </div>
            </div>
        `;

        this.currentModal = new Modal({
            title: '',
            content: content
        }).open();
    }
}
