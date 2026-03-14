import { Notification } from '../components/Notification.js';

export class ValidationService {
    // Validar empleado
    static validateEmployee(data) {
        const errors = [];

        if (!data.name || data.name.trim().length === 0) {
            errors.push('El nombre es requerido');
        }

        if (data.name && data.name.length > 100) {
            errors.push('El nombre es demasiado largo (máx 100 caracteres)');
        }

        if (!data.positions || data.positions.length === 0) {
            errors.push('Debe seleccionar al menos una posición');
        }

        if (data.phone && !/^[\d\s\-\+\(\)]*$/.test(data.phone)) {
            errors.push('Formato de teléfono inválido');
        }

        if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
            errors.push('Formato de email inválido');
        }

        return {
            valid: errors.length === 0,
            errors
        };
    }

    // Validar posición
    static validatePosition(data) {
        const errors = [];

        if (!data.name || data.name.trim().length === 0) {
            errors.push('El nombre de la posición es requerido');
        }

        if (!data.baseSalary || data.baseSalary <= 0) {
            errors.push('El sueldo base debe ser mayor a 0');
        }

        if (data.color && !/^#[0-9A-F]{6}$/i.test(data.color)) {
            errors.push('Color inválido (debe ser formato HEX)');
        }

        return {
            valid: errors.length === 0,
            errors
        };
    }

    // Validar líder
    static validateLeader(data) {
        const errors = [];

        if (!data.name || data.name.trim().length === 0) {
            errors.push('El nombre del líder es requerido');
        }

        if (!data.code || data.code.trim().length === 0) {
            errors.push('El código del líder es requerido');
        }

        return {
            valid: errors.length === 0,
            errors
        };
    }

    // Mostrar errores
    static showErrors(errors) {
        if (errors.length === 0) return;

        const message = errors.join('\n• ');
        Notification.error(`\ Errores de validación:\n• ${message}`, 6000);
    }
}
