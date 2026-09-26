import { buildPayrollClosureId, validatePayrollClosureForScopedWrite } from '../payroll/PayrollClosure.js';

const id = value => String(value ?? '').trim();
const list = value => Array.isArray(value) ? value : [];
const copy = value => value == null ? value : JSON.parse(JSON.stringify(value));
const canonical = value => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const referenceKeys = new Set(['payrollClosureId', 'payrollSupersedesClosureId', 'closureId', 'supersedesClosureId']);

export function recoveredClosureSources(closures) {
    return new Set(list(closures).filter(c => c?.recovery?.sourceId && c.projectId)
        .map(c => id(c.recovery.sourceId)));
}

/** Explicit, pure recovery plan. Originals remain available; money is never recomputed. */
export function planFinancialRecovery({
    employees = [], projects = [], payrollClosures = [], projectPayrollConfigs = [],
    targetProjectId, employeeIds = [], timestamp = Date.now(), configurationSource = ''
}) {
    const target = id(targetProjectId);
    const known = new Set(projects.map(p => id(p.id)).filter(Boolean));
    if (!target || !projects.some(p => id(p.id) === target && p.status === 'active')) {
        throw new Error('La obra de destino no está disponible o no está activa.');
    }
    const selected = new Set(employeeIds.map(id));
    const orphan = value => !known.has(id(value));
    const employeeMap = new Map(employees.map(e => [id(e.id), e]));
    const closures = new Map(payrollClosures.map(c => [id(c.id), c]));
    const closureMap = new Map(), newClosures = [], visiting = new Set();
    const ensureEmployee = employeeId => {
        const employee = employeeMap.get(id(employeeId));
        if (!selected.has(id(employeeId)) || !employee || id(employee.projectId) !== target) {
            throw new Error('Incluye todos los empleados del cierre y asígnalos a esta obra para recuperar sus datos financieros.');
        }
    };
    // A retry must reuse the recovered identity, even when its source still exists.
    for (const closure of payrollClosures) {
        if (!closure?.recovery?.sourceId || id(closure.projectId) !== target) continue;
        const key = id(closure.recovery.sourceId);
        if (closureMap.has(key) && closureMap.get(key) !== closure.id) {
            throw new Error('Hay más de una recuperación para el mismo cierre.');
        }
        validatePayrollClosureForScopedWrite(closure, target);
        closureMap.set(key, closure.id);
    }
    function recoverClosure(source) {
        if (closureMap.has(id(source.id))) return closureMap.get(id(source.id));
        if (payrollClosures.some(c => id(c?.recovery?.sourceId) === id(source.id) && id(c.projectId) !== target)) {
            throw new Error('El cierre ya fue recuperado en otra obra. Revisa su origen.');
        }
        if (visiting.has(id(source.id))) throw new Error('Los cierres tienen referencias circulares.');
        visiting.add(id(source.id));
        if (!source.id || !list(source.rows).length) throw new Error('El cierre original está incompleto.');
        source.rows.forEach(row => ensureEmployee(row.employeeId));
        let predecessor = source.supersedesId || null;
        if (predecessor) {
            const previous = closures.get(id(predecessor));
            if (!previous) throw new Error('Falta un cierre anterior relacionado.');
            if (orphan(previous.projectId)) predecessor = recoverClosure(previous);
            else if (id(previous.projectId) !== target) throw new Error('Un cierre anterior pertenece a otra obra existente.');
        }
        const restored = { ...copy(source), schemaVersion: 3, projectId: target, supersedesId: predecessor, periodKey: source.periodStart + ':' + source.periodEnd };
        delete restored.identityKind;
        delete restored.ownershipToken;
        restored.fingerprint = JSON.stringify({
            projectId: target, periodStart: source.periodStart, periodEnd: source.periodEnd, rows: copy(source.rows)
        });
        restored.id = buildPayrollClosureId(restored.fingerprint, predecessor, target);
        restored.recovery = {
            sourceId: source.id, sourceProjectId: source.projectId ?? null,
            sourceFingerprint: source.fingerprint, recoveredAt: timestamp
        };
        validatePayrollClosureForScopedWrite(restored, target);
        const existing = closures.get(restored.id) || newClosures.find(c => c.id === restored.id);
        if (existing && existing.recovery?.sourceId !== source.id) {
            throw new Error('La obra ya contiene un cierre equivalente. Revisa ambos antes de unirlos.');
        }
        if (!existing) newClosures.push(restored);
        closureMap.set(id(source.id), restored.id);
        visiting.delete(id(source.id));
        return restored.id;
    }
    for (const closure of payrollClosures) {
        if (orphan(closure.projectId) && list(closure.rows).some(row => selected.has(id(row.employeeId)))) {
            recoverClosure(closure);
        }
    }
    function rewriteReferences(value) {
        if (Array.isArray(value)) return value.map(rewriteReferences);
        if (!value || typeof value !== 'object') return value;
        const result = {};
        for (const [key, child] of Object.entries(value)) {
            if (key === 'projectRecovery') { result[key] = copy(child); continue; }
            if (referenceKeys.has(key) && id(child)) {
                const closure = closures.get(id(child));
                if (!closureMap.has(id(child)) && (!closure || id(closure.projectId) !== target)) {
                    throw new Error('Falta un cierre relacionado o pertenece a otra obra. No se modificaron sus pagos.');
                }
                result[key] = closureMap.get(id(child)) || child;
            } else result[key] = rewriteReferences(child);
        }
        return result;
    }
    const changes = [];
    for (const original of employees) {
        if (!selected.has(id(original.id))) continue;
        ensureEmployee(original.id);
        const employee = copy(original);
        let changed = false;
        for (const kind of ['loans', 'advances', 'bonuses', 'deductions']) {
            if (!Array.isArray(original[kind])) continue;
            employee[kind] = original[kind].map(record => {
                if (!record || typeof record !== 'object') return record;
                // Existing works, including archived ones, are never migrated.
                if (!orphan(record.projectId) && id(record.projectId) !== target) return record;
                if (record.employeeId && id(record.employeeId) !== id(employee.id)) {
                    throw new Error('Un plan identifica a otro empleado. Revisa su origen.');
                }
                let next = copy(record);
                if (orphan(record.projectId)) {
                    next.projectId = target;
                    next.projectRecovery = { originalProjectId: record.projectId ?? null, recoveredAt: timestamp };
                }
                // Preserve valid foreign payments; resolve only unscoped/missing ownership.
                if (Array.isArray(record.payments)) next.payments = record.payments.map(payment => {
                    const previous = payment.payrollProjectId || payment.projectId || payment.payrollBatchSnapshot?.projectId;
                    if (!orphan(previous) && id(previous) !== target) return copy(payment);
                    const patched = rewriteReferences(copy(payment));
                    if (orphan(previous) || !same(patched, payment)) {
                        patched.projectRecovery = payment.projectRecovery || {
                            originalProjectId: previous ?? null, originalClosureId: payment.payrollClosureId ?? null,
                            originalBatchSnapshot: copy(payment.payrollBatchSnapshot) || null, recoveredAt: timestamp
                        };
                        patched.projectId = target;
                        if (payment.source === 'payroll' || 'payrollProjectId' in payment || payment.payrollClosureId || payment.payrollBatchId) {
                            patched.payrollProjectId = target;
                        }
                        if (patched.payrollBatchSnapshot) patched.payrollBatchSnapshot.projectId = target;
                        patched.updatedAt = timestamp;
                    }
                    return patched;
                });
                // Rewrite the plan and installment history, keeping the original history for audit.
                const payments = next.payments;
                delete next.payments;
                const rewritten = rewriteReferences(next);
                if (Array.isArray(record.payments)) rewritten.payments = payments;
                if (!same(rewritten, record)) {
                    rewritten.projectRecovery = rewritten.projectRecovery || {
                        originalProjectId: record.projectId ?? null, recoveredAt: timestamp
                    };
                    if (record.history && !rewritten.projectRecovery.originalHistory) {
                        rewritten.projectRecovery.originalHistory = copy(record.history);
                    }
                    rewritten.updatedAt = timestamp;
                    changed = true;
                }
                return rewritten;
            });
        }
        if (changed) { employee.updatedAt = timestamp; changes.push(employee); }
    }
    const configs = [];
    if (configurationSource) {
        const source = projectPayrollConfigs.find(c => id(c.projectId) === id(configurationSource));
        if (!source || !orphan(source.projectId)) throw new Error('La configuración elegida ya no está disponible como huérfana.');
        const destination = projectPayrollConfigs.find(c => id(c.projectId) === target);
        if (destination && id(destination.projectRecovery?.originalProjectId) !== id(source.projectId)) {
            throw new Error('La obra ya tiene configuración de nómina. Se conserva la actual; revisa las reglas antes de sustituirla.');
        }
        if (!destination) configs.push({ ...copy(source), projectId: target, updatedAt: timestamp,
            projectRecovery: { originalProjectId: source.projectId ?? null, recoveredAt: timestamp } });
    }
    return { employees: changes, closures: newClosures, configs, closureMap };
}
