/**
 * 📖 helpTexts.js — Diccionario centralizado de textos de ayuda
 *
 * Cada entrada describe un concepto o campo de la app.
 * Estructura: { title, body }
 *   - title: encabezado corto (visible en el modal)
 *   - body:  explicación clara, con ejemplos si ayuda
 *
 * Cómo agregar uno nuevo:
 *   1. Añadir la entrada con clave descriptiva (módulo.campo)
 *   2. Insertar `${HelpTooltip.render('mi.clave')}` en el HTML correspondiente
 *
 * Cómo usar:
 *   import { HelpTooltip } from './HelpTooltip.js';
 *   `<label>Tarifa por hora ${HelpTooltip.render('position.hourlyRate')}</label>`
 */

export const HELP_TEXTS = {
    // ─────────────────────────────────────────────────────────
    // Posiciones / Puestos de trabajo
    // ─────────────────────────────────────────────────────────
    'position.hourlyRate': {
        title: '💰 Tarifa por hora',
        body: 'Sueldo por cada hora trabajada en esta posición. Es la base del cálculo de nómina.\n\nEjemplo: $144/h equivale a $24,940/mes con jornada de 8h × 5 días por semana.'
    },
    'position.workingDays': {
        title: '📅 Días laborales',
        body: 'Días normales de trabajo para esta posición.\n\nSe usa para calcular el sueldo mensual estimado y los días esperados de asistencia.'
    },
    'position.color': {
        title: '🎨 Color de la posición',
        body: 'Identificador visual rápido. Aparece en listas, calendario y reportes para distinguir cada posición de un vistazo.'
    },
    'position.leader': {
        title: '👤 Líder responsable',
        body: 'Persona que supervisa esta posición. Sirve para agrupar reportes y filtrar empleados a su cargo.'
    },

    // ─────────────────────────────────────────────────────────
    // Empleados
    // ─────────────────────────────────────────────────────────
    'employee.customSalary': {
        title: '💵 Tarifa personalizada',
        body: 'Sobreescribe la tarifa estándar de la posición SOLO para este empleado.\n\nÚtil cuando un empleado tiene un acuerdo distinto al estándar (más experiencia, especialización, etc.).'
    },
    'employee.multiPosition': {
        title: '🔄 Multi-posición',
        body: 'Permite distribuir las horas de un día entre varias posiciones.\n\nÚtil cuando un empleado hace tareas mixtas. Ejemplo: 4h como ayudante + 4h como pintor en el mismo día.'
    },
    'employee.number': {
        title: '🔢 Número de empleado',
        body: 'Identificador único e interno. Sirve para distinguir empleados con nombres similares y para usar en reportes oficiales.'
    },

    // ─────────────────────────────────────────────────────────
    // Nómina y factores
    // ─────────────────────────────────────────────────────────
    'payroll.overtimeFactor': {
        title: '⏰ Factor de horas extras',
        body: 'Multiplicador del sueldo por hora extra.\n\n• 1.0 = igual que regular (sin bonificación)\n• 1.5 = 50% más por hora extra\n• 2.0 = doble por hora extra'
    },
    'payroll.holidayFactor': {
        title: '🎉 Factor de día festivo',
        body: 'Multiplicador del sueldo cuando se trabaja en día festivo.\n\nEn República Dominicana, lo común es 2.0 (doble pago). Configurable según tus políticas.'
    },
    'payroll.periodLength': {
        title: '📆 Duración del período',
        body: 'Cantidad de días de un ciclo de nómina.\n\nValores típicos: 7 (semanal), 15 (quincenal), 21 (3 semanas), 30 (mensual).'
    },

    // ─────────────────────────────────────────────────────────
    // Adelantos y deducciones
    // ─────────────────────────────────────────────────────────
    'advance.amount': {
        title: '🏦 Adelanto',
        body: 'Dinero entregado a un empleado ANTES del día de pago.\n\nSe descuenta automáticamente de la próxima nómina.'
    },
    'deduction.value': {
        title: '➖ Deducción',
        body: 'Descuento sobre el sueldo del empleado.\n\nPuede ser monto fijo (ej: $500) o porcentaje (ej: 5%). Se aplica al cierre del período.'
    },

    // ─────────────────────────────────────────────────────────
    // Sistema y backups
    // ─────────────────────────────────────────────────────────
    'system.snapshots': {
        title: '📸 Copias de seguridad (snapshots)',
        body: 'Versiones automáticas de tus datos guardadas en la nube.\n\nSi algo sale mal, puedes restaurar a un punto anterior. Recomendado: dejar la frecuencia automática en "diaria".'
    },
    'system.indexedDB': {
        title: '💾 Almacenamiento local',
        body: 'IndexedDB es la base de datos del navegador.\n\n• Más rápida que localStorage\n• Soporta más datos (hasta varios GB)\n• Recomendada para uso normal'
    }
};
