export class Employee {
    constructor(data) {
        this.id = data.id || `EMP${Date.now()}`;
        this.key = data.key || this.id; // Compatibilidad con código viejo
        this.number = data.number;
        this.name = data.name;
        this.positions = data.positions || [];
        this.customSalary = data.customSalary || null;
        this.active = data.active !== undefined ? data.active : true;
        this.hireDate = data.hireDate || new Date().toISOString().split('T')[0];
        this.phone = data.phone || '';
        this.email = data.email || '';
        this.positionSalaries = data.positionSalaries || {}; // ⚡ NUEVO: { positionId: hourlyRate }
        // ⚡ Aditivo: modo de carga por puesto { positionId: 'hourly' | 'daily' }. Solo
        // afecta cómo se muestra/edita; positionSalaries sigue guardando por hora.
        this.positionSalaryModes = data.positionSalaryModes || {};
        this.customWorkingDays = data.customWorkingDays || {}; // { positionId: [1,2,3,4,5] }
        this.notes = data.notes || '';
        this.advances = data.advances || [];
        this.bonuses = data.bonuses || [];
        this.deductions = data.deductions || [];
        this.loans = data.loans || [];
        this.createdDate = data.createdDate || new Date().toISOString();
        this.lastStatusChange = data.lastStatusChange || null;
        this.statusHistory = data.statusHistory || [];
        this.updatedAt = data.updatedAt || Date.now();
        // Frescura ESPECÍFICA de puestos (LWW fino en EmployeeMerge). null (no
        // undefined) cuando falta: Firestore rechaza campos con valor undefined
        // y saveOne hace payload = {...employee} sin limpiarlos. positionsTs
        // trata null igual que ausente, así que la semántica del merge no cambia.
        this.positionsUpdatedAt = typeof data.positionsUpdatedAt === 'number' ? data.positionsUpdatedAt : null;
    }

    // Métodos de negocio
    activate() {
        this.active = true;
        this.lastStatusChange = new Date().toISOString();
        this.statusHistory.push({
            date: this.lastStatusChange,
            active: true,
            timestamp: Date.now()
        });
        this.updatedAt = Date.now();
        return this;
    }

    deactivate() {
        this.active = false;
        this.lastStatusChange = new Date().toISOString();
        this.statusHistory.push({
            date: this.lastStatusChange,
            active: false,
            timestamp: Date.now()
        });
        this.updatedAt = Date.now();
        return this;
    }

    hasPosition(positionId) {
        return this.positions.includes(positionId);
    }

    addPosition(positionId) {
        if (!this.hasPosition(positionId)) {
            this.positions.push(positionId);
            this.updatedAt = Date.now();
        }
        return this;
    }

    removePosition(positionId) {
        this.positions = this.positions.filter(p => p !== positionId);
        this.updatedAt = Date.now();
        return this;
    }

    toJSON() {
        return {
            id: this.id,
            key: this.key,
            number: this.number,
            name: this.name,
            positions: this.positions,
            customSalary: this.customSalary,
            positionSalaries: this.positionSalaries,
            positionSalaryModes: this.positionSalaryModes,
            customWorkingDays: this.customWorkingDays,
            active: this.active,
            hireDate: this.hireDate,
            phone: this.phone,
            email: this.email,
            notes: this.notes,
            advances: this.advances,
            bonuses: this.bonuses,
            deductions: this.deductions,
            loans: this.loans,
            createdDate: this.createdDate,
            lastStatusChange: this.lastStatusChange,
            statusHistory: this.statusHistory,
            updatedAt: this.updatedAt,
            positionsUpdatedAt: this.positionsUpdatedAt
        };
    }

    static fromJSON(json) {
        return new Employee(json);
    }
}

/**
 * Detecta si los puestos o sus salarios cambiaron de verdad entre dos versiones.
 * EmployeeModal re-asigna emp.positions en CADA guardado (aunque sólo cambie el
 * teléfono), así que la estampa de positionsUpdatedAt debe ser CONDICIONAL: sin
 * esto, editar un campo ajeno movería la frescura de puestos y pisaría los
 * puestos del otro dispositivo en el merge. Compara positions como conjunto (el
 * orden no importa) y positionSalaries como mapa (claves y valores).
 *
 * @returns {boolean} true si difieren.
 */
export function positionsChanged(prevPositions, newPositions, prevSalaries, newSalaries) {
    const prevP = Array.isArray(prevPositions) ? prevPositions.map(String) : [];
    const newP = Array.isArray(newPositions) ? newPositions.map(String) : [];
    if (prevP.length !== newP.length) return true;
    const prevSet = new Set(prevP);
    if (newP.some(p => !prevSet.has(p))) return true;

    const ps = (prevSalaries && typeof prevSalaries === 'object') ? prevSalaries : {};
    const ns = (newSalaries && typeof newSalaries === 'object') ? newSalaries : {};
    const psKeys = Object.keys(ps);
    const nsKeys = Object.keys(ns);
    if (psKeys.length !== nsKeys.length) return true;
    return nsKeys.some(k => ps[k] !== ns[k]);
}
