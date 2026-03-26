/**
 * ModalManager.js
 * Gestión profesional de modales y diálogos de la aplicación.
 */

import { state } from './AppState.js';
import { Notification } from '../components/Notification.js';
// Nota: render se importará circularmente o se inyectará. 
// Para evitar circularidad en esta fase, usaremos la referencia global window.render temporalmente 
// hasta que RenderManager esté listo.

export class ModalManager {
    constructor() {
        this.state = state;
    }

    // Abrir modal avanzado de asistencia
    openAdvanced(employeeId, forceMultiPosition = false) {
        const emp = this.state.employees.find(e => e.id === employeeId);
        if (!emp) {
            Notification.error('❌ Empleado no encontrado');
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

        if (window.render) window.render();
    }

    // Abrir desde menú contextual (vista semana)
    openFromContext() {
        if (!this.state.contextMenu) return;

        const emp = this.state.employees.find(e => e.id === this.state.contextMenu.employeeId);
        if (!emp) return;

        // Cambiar temporalmente selectedDate al día clickeado
        this.state.selectedDate = this.state.contextMenu.date;

        this.openAdvanced(emp.id);
        this.state.contextMenu = null; // Cerrar menú
    }

    // Cerrar modal
    close() {
        this.state.showModal = false;
        this.state.modalType = null;
        this.state.selectedEmployee = null;
        this.state.showOptionalFields = false;
        this.state.isFractionated = false;
        if (window.render) window.render();
    }
}

export const modalManager = new ModalManager();
