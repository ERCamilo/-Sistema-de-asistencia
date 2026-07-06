/**
 * ✅ ManualGroupValidator.js (Tarea #21)
 *
 * Función pura que valida las decisiones del usuario sobre un grupo
 * de duplicados que está resolviendo manualmente. Le dice si las
 * decisiones son consistentes y cuáles son las acciones a ejecutar.
 *
 * Cada miembro lleva un campo `role`:
 *   'master'   → ganador del grupo (exactamente uno o ninguno).
 *   'absorb'   → se fusiona en el master.
 *   'separate' → no es la misma persona; será reasignado.
 *   null       → indeciso (bloquea la aplicación).
 *
 * Casos válidos:
 *   - 1 master + 0+ absorb + 0+ separate.
 *   - 0 master + N separate (todos se reasignan, el grupo se disuelve).
 *
 * Casos inválidos:
 *   - 0 master + ≥1 absorb (no se sabe en quién fusionar).
 *   - >1 master (ambiguo).
 *   - Algún miembro con role=null.
 */

export function validateManualGroup(members) {
    const errors = [];
    const result = { ok: false, errors, masterId: null, absorbIds: [], separateIds: [], deleteIds: [] };

    if (!Array.isArray(members) || members.length === 0) {
        errors.push('No hay miembros que validar.');
        return result;
    }

    const masters  = [];
    const absorbs  = [];
    const separates = [];
    const deletes  = [];   // Feature #2: 'delete' → tombstone (independiente; no requiere master)
    const undecided = [];

    members.forEach(m => {
        if (!m || !m.id) return;
        switch (m.role) {
            case 'master':   masters.push(m.id);   break;
            case 'absorb':   absorbs.push(m.id);   break;
            case 'separate': separates.push(m.id); break;
            case 'delete':   deletes.push(m.id);   break;
            default:         undecided.push(m.id); break;
        }
    });

    if (undecided.length > 0) {
        errors.push(`Falta decidir qué hacer con: ${undecided.join(', ')}.`);
    }

    if (masters.length > 1) {
        errors.push(`Solo puede haber un maestro por grupo (recibido: ${masters.length}).`);
    }

    if (masters.length === 0 && absorbs.length > 0) {
        errors.push('No se puede fusionar sin un maestro. Elige el principal.');
    }

    // Asignar al resultado solo si no hay errores fatales.
    if (errors.length === 0) {
        result.ok = true;
        result.masterId   = masters[0] || null;
        result.absorbIds  = absorbs;
        result.separateIds = separates;
        result.deleteIds  = deletes;
    }

    return result;
}

export default validateManualGroup;
