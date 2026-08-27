/**
 * OnboardingApply.js — commit ATÓMICO del setup del onboarding v2 al estado real
 * de la app. Se invoca UNA vez en la transición configuración→listo ("Finalizar")
 * y aplica, en orden: ajustes → posición → empleados → guardado completo → flag.
 *
 * Contrato: applySetup(v2state, deps?) → Promise<{applied:boolean, error?}>.
 * Si cualquier escritura falla, NO se guarda y NO se marca la finalización.
 *
 * Deps inyectables (defaults perezosos resueltos en call time; nunca importa
 * app.js — mismo patrón que OnboardingActions):
 *   updateSettings(patch)         — patch plano sobre los ajustes reales.
 *                                    Default: Object.assign dentro de un batch de stateManager.
 *   createPosition(data) → record — crea la posición REAL con la misma forma que
 *                                    PositionModal.save (push + _isDirty); id con
 *                                    generateUUID. Debe devolver el registro creado.
 *   createEmployee(data) → record — crea el empleado REAL con la misma forma que
 *                                    EmployeeModal.save. data.number llega explícito
 *                                    (capacidad de número editable del modal); el default
 *                                    valida unicidad igual que el modal (comparación por
 *                                    number) y hace bump incremental si colisiona.
 *                                    Id con generateUUID: 'emp-' + Date.now() colisionaría
 *                                    al crear varios en el mismo milisegundo.
 *   saveAll()                     — guardado completo estándar. Default: saveApplicationData()
 *                                    (PersistenceService), exactamente lo que hacía
 *                                    ui/Onboarding.complete() en modo scratch.
 *   storage                       — storage para markCompleted (reutilizado de OnboardingActions).
 */
import { state, stateManager } from '../../core/AppState.js';
import { saveApplicationData } from '../../services/PersistenceService.js';
import { generateUUID } from '../../utils/Helpers.js';
import { COLOR_PALETTE } from '../../utils/Constants.js';
import { markCompleted } from './OnboardingActions.js';

/* Días v2 (idx 0=L … 6=D) → números de día JS (1=Lun … 6=Sáb, 0=Dom). */
function mapWorkingDays(days) {
    const out = [];
    days.forEach((on, i) => { if (on) out.push(i === 6 ? 0 : i + 1); });
    return out;
}

/* Misma validación de unicidad que EmployeeModal (find por number): si el número
 * pedido está libre se respeta; si colisiona, bump max+1 hasta uno libre. */
export function uniqueNumber(number, employees) {
    const taken = new Set(employees.map(e => e.number));
    if (!taken.has(number)) return number;
    const nums = employees.map(e => parseInt(e.number, 10)).filter(Number.isFinite);
    let n = nums.length ? Math.max(...nums) + 1 : employees.length + 1;
    while (taken.has(String(n).padStart(3, '0'))) n++;
    return String(n).padStart(3, '0');
}

function resolveDeps(deps = {}) {
    return {
        updateSettings: deps.updateSettings || (patch => {
            /* Un solo batch para TODAS las escrituras del commit: mismo mecanismo
             * multi-clave del resto de los módulos (un único render al final). */
            stateManager.batchSetState(() => {
                Object.assign(state.settings, patch);
            });
        }),
        createPosition: deps.createPosition || (data => {
            let record = null;
            stateManager.batchSetState(() => {
                record = {
                    id: generateUUID(),
                    name: data.name,
                    hourlyRate: data.hourlyRate,
                    salaryInputMode: data.salaryInputMode,
                    workingDays: data.workingDays.slice(),
                    leaderId: null,
                    color: data.color,
                    icon: null,
                    active: true,
                    updatedAt: Date.now(),
                    _isDirty: true
                };
                state.positions.push(record);
            });
            return record;
        }),
        createEmployee: deps.createEmployee || (data => {
            let record = null;
            stateManager.batchSetState(() => {
                const number = uniqueNumber(String(data.number), state.employees);
                const newId = generateUUID();
                const nowNew = Date.now();
                const hireDate = new Date().toISOString().split('T')[0];
                record = {
                    id: newId, key: newId, number,
                    name: data.name,
                    positions: data.positions.slice(),
                    positionSalaries: {}, positionSalaryModes: {},
                    active: true, hireDate, phone: '', email: '', notes: '',
                    statusHistory: [{ date: hireDate, active: true, timestamp: nowNew }],
                    updatedAt: nowNew, positionsUpdatedAt: nowNew, _isDirty: true
                };
                state.employees.push(record);
            });
            return record;
        }),
        saveAll: deps.saveAll || (() => saveApplicationData()),
        storage: deps.storage || localStorage
    };
}

const errText = e => (e && e.message ? String(e.message) : String(e));

export async function applySetup(s, deps) {
    const d = resolveDeps(deps);
    try {
        d.updateSettings({
            companyName: s.company.trim(),
            regularHoursPerDay: Number(s.hours) || 8
        });
        const position = d.createPosition({
            name: s.posName.trim(),
            color: COLOR_PALETTE[s.posColorIdx] || COLOR_PALETTE[0],
            workingDays: mapWorkingDays(s.days),
            hourlyRate: parseFloat(s.posRate) || 0,
            salaryInputMode: 'hourly'
        });
        for (const emp of s.employees) {
            d.createEmployee({ number: emp.code, name: emp.name, positions: [position.id] });
        }
        await d.saveAll();
    } catch (err) {
        return { applied: false, error: errText(err) };
    }
    markCompleted(d.storage);
    return { applied: true };
}
