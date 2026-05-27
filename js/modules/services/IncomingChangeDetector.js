/**
 * 🔍 IncomingChangeDetector.js (Track 2)
 *
 * Función pura que compara el state local con un payload remoto que
 * acaba de llegar de Firebase, y clasifica los cambios por severidad.
 *
 * Permite que el callback de subscribeToChanges decida si:
 *   - Aplicar silenciosamente (todos los cambios trivial).
 *   - Pedir confirmación al usuario (algún cambio significant).
 *
 * Severidad:
 *   trivial      → cambio esperado y benigno (nuevos empleados, cambio
 *                  de email, schemaVersion subiendo).
 *   significant  → cambio que merece una revisión humana (borrado de
 *                  entidades, caída de préstamos en un empleado,
 *                  divergencia en campo crítico, schemaVersion bajando).
 *
 * No hace IO, no lee globals, no muta inputs.
 */

// Campos escalares cuya divergencia ENTRE el mismo id local y remoto
// se considera significant (afectan reportes/nómina/identidad).
const CRITICAL_SCALARS = ['number', 'name', 'salary', 'customSalary'];

function asArray(x)  { return Array.isArray(x) ? x : []; }
function asObject(x) { return x && typeof x === 'object' ? x : {}; }

function indexById(arr) {
    const m = new Map();
    asArray(arr).forEach(item => {
        if (item && item.id) m.set(String(item.id), item);
    });
    return m;
}

function detectEntityChanges(localArr, remoteArr, entityType, accumulator) {
    const localIdx = indexById(localArr);
    const remoteIdx = indexById(remoteArr);

    // Borrados: en local pero NO en remoto.
    localIdx.forEach((emp, id) => {
        if (!remoteIdx.has(id)) {
            accumulator.push({
                kind: 'deletion',
                severity: 'significant',
                entityType,
                entityId: id,
                description: `${entityType} ${emp.name || id} eliminado en la nube`,
                before: emp,
                after: null
            });
        }
    });

    // Adiciones: en remoto pero NO en local.
    remoteIdx.forEach((emp, id) => {
        if (!localIdx.has(id)) {
            accumulator.push({
                kind: 'addition',
                severity: 'trivial',
                entityType,
                entityId: id,
                description: `${entityType} ${emp.name || id} añadido desde otro dispositivo`,
                before: null,
                after: emp
            });
        }
    });

    // Divergencias: mismo id en ambos lados con diferencias en campos críticos.
    localIdx.forEach((localEmp, id) => {
        const remoteEmp = remoteIdx.get(id);
        if (!remoteEmp) return;

        for (const field of CRITICAL_SCALARS) {
            const localVal = localEmp[field];
            const remoteVal = remoteEmp[field];
            if (localVal === remoteVal) continue;
            // Ignorar si ambos son falsy (vacíos equivalentes).
            if (!localVal && !remoteVal) continue;

            accumulator.push({
                kind: 'scalar-divergence',
                severity: 'significant',
                entityType,
                entityId: id,
                description: `${entityType} ${localEmp.name || id}: ${field} cambió de "${localVal}" a "${remoteVal}"`,
                before: localVal,
                after: remoteVal,
                field
            });
        }

        // Array drops: para empleados, comprobar loans/advances/bonuses/deductions.
        if (entityType === 'employee') {
            ['loans', 'advances', 'bonuses', 'deductions'].forEach(arrField => {
                const localCount = asArray(localEmp[arrField]).length;
                const remoteCount = asArray(remoteEmp[arrField]).length;
                if (remoteCount < localCount) {
                    accumulator.push({
                        kind: 'array-drop',
                        severity: 'significant',
                        entityType,
                        entityId: id,
                        description: `${localEmp.name || id} pierde ${localCount - remoteCount} ${arrField} en la nube`,
                        before: localCount,
                        after: remoteCount,
                        field: arrField
                    });
                }
            });
        }
    });
}

function detectSchemaMismatch(localState, remoteData, accumulator) {
    const localV = asObject(localState).settings?.schemaVersion;
    const remoteV = remoteData?.schemaVersion;
    if (typeof localV !== 'number' || typeof remoteV !== 'number') return;
    if (localV === remoteV) return;

    accumulator.push({
        kind: 'schema-mismatch',
        // Si la nube subió la versión, es trivial (migración esperable).
        // Si la nube BAJÓ la versión local, es significant (algo raro).
        severity: remoteV > localV ? 'trivial' : 'significant',
        entityType: 'settings',
        entityId: null,
        description: `schemaVersion local=${localV}, remoto=${remoteV}`,
        before: localV,
        after: remoteV
    });
}

/**
 * @param {object|null} localState  El state actual de la app.
 * @param {object|null} remoteData  El payload recibido de Firebase.
 * @returns {Array<Change>}
 */
export function detectIncomingChanges(localState, remoteData) {
    if (!localState || !remoteData) return [];
    const local  = asObject(localState);
    const remote = asObject(remoteData);

    const changes = [];

    detectEntityChanges(local.employees, remote.employees, 'employee', changes);
    detectEntityChanges(local.positions, remote.positions, 'position', changes);
    detectEntityChanges(local.leaders,   remote.leaders,   'leader',   changes);
    detectSchemaMismatch(local, remote, changes);

    return changes;
}

/**
 * Helper de conveniencia: ¿hay AL MENOS un cambio significant?
 */
export function hasSignificantChanges(localState, remoteData) {
    return detectIncomingChanges(localState, remoteData)
        .some(c => c.severity === 'significant');
}

export default detectIncomingChanges;
