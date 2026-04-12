import { analyzeConflicts, saveApplicationData } from '../services/PersistenceService.js';
import { state } from '../core/AppState.js';
import { Modal } from './Modal.js';
import icons from '../ui/IconSystem.js';

export class SystemAlertsManager {
    constructor() {
        this.sessionIgnored = false;
        this.currentConflicts = 0;
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
        if (!this.shouldShowDuplicateAlert()) return '';

        return `
            <button class="header-icon-btn warning-alert heartbeat" onclick="window._systemAlerts.showResolutionDialog()" title="Alertas del Sistema: Tienes duplicados">
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
                    <button class="btn primary" onclick="if(window._systemAlerts.currentModal) window._systemAlerts.currentModal.close(); if(window._maintenanceUI) window._maintenanceUI.start();" style="width: 100%; justify-content: center; padding: 12px; font-size: 1rem;">
                        ✨ Iniciar Asistente de Solución Rápida
                    </button>
                    
                    <div style="display: flex; gap: 10px; margin-top: 5px;">
                        <button class="btn secondary" onclick="window._systemAlerts.ignoreTemporarily()" style="flex: 1; justify-content: center; background: transparent; border: 1px solid #475569;">
                            Ignorar hasta reiniciar
                        </button>
                        <button class="btn secondary" onclick="window._systemAlerts.ignorePermanently()" style="flex: 1; justify-content: center; background: transparent; border: 1px solid #475569; color: #94a3b8;">
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
