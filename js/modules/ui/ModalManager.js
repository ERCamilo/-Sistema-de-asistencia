/**
 * 🎨 ModalManager.js - Orquestador de Diálogos y Modales
 * Parte de la Fase 6: Infraestructura de UI (Alpha Refactorizer)
 */

export class ModalManager {
    constructor(state, renderCallback, notificationSystem) {
        this.state = state;
        this.render = renderCallback;
        this.Notification = notificationSystem;
    }

    /**
     * Abrir modal avanzado de asistencia
     * @param {string} employeeId 
     * @param {boolean} forceMultiPosition 
     */
    openAdvanced(employeeId, forceMultiPosition = false) {
        const emp = this.state.employees.find(e => e.id === employeeId);
        if (!emp) {
            this.Notification.error('❌ Empleado no encontrado');
            return;
        }

        this.state.selectedEmployee = emp;
        this.state.modalType = 'advanced';
        this.state.showModal = true;

        // Determinar si debe abrir en modo fraccionado
        const key = `${employeeId}-${this.state.selectedDate}`;
        const att = this.state.attendance[key];

        if (forceMultiPosition) {
            this.state.isFractionated = true;
        } else if (att && att.multiPosition) {
            this.state.isFractionated = true;
        } else if (att && att.present && emp.positions.length > 1) {
            this.state.isFractionated = true;
        } else {
            this.state.isFractionated = false;
        }

        this.render();
    }

    /**
     * Abrir desde menú contextual (vista semana)
     */
    openFromContext() {
        if (!this.state.contextMenu) return;

        const emp = this.state.employees.find(e => e.id === this.state.contextMenu.employeeId);
        if (!emp) return;

        // La fecha del menú contextual ya es string (YYYY-MM-DD)
        this.state.selectedDate = this.state.contextMenu.date;

        this.openAdvanced(emp.id);
        this.state.contextMenu = null; // Cerrar menú
    }

    /**
     * Cerrar modal y limpiar estado
     */
    close() {
        this.state.showModal = false;
        this.state.modalType = null;
        this.state.selectedEmployee = null;
        this.state.showOptionalFields = false;
        this.state.isFractionated = false;
        this.render();
    }
}
