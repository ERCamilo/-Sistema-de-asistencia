export class Attendance {
    constructor(data) {
        this.employeeId = data.employeeId;
        this.date = data.date;
        this.present = data.present !== undefined ? data.present : false;
        this.hoursWorked = data.hoursWorked || 0;
        this.overtimeHours = data.overtimeHours || 0;
        this.isHoliday = data.isHoliday || false;
        this.selectedPosition = data.selectedPosition || null;
        this.multiPosition = data.multiPosition || false;
        this.positionHours = data.positionHours || [];
        this.notes = data.notes || '';
        this.deviceId = data.deviceId || null;
        // Fase 1 (U1a): frescura por-registro. `updatedAt` sobrevive el
        // round-trip persistir→cargar (antes se descartaba acá y en toJSON),
        // así el merge entrante (U3) puede comparar por registro en vez del
        // spread ciego. Default 0 = legacy "más viejo posible": nunca inventa
        // una frescura que no tenemos. `deletedAt` es el tombstone (U2): un
        // borrado marcado viaja como dato y no se confunde con "nunca existió".
        this.updatedAt = data.updatedAt || 0;
        this.deletedAt = (data.deletedAt !== undefined) ? data.deletedAt : null;
    }

    get key() {
        return `${this.employeeId}-${this.date}`;
    }

    get totalHours() {
        return this.hoursWorked + this.overtimeHours;
    }

    addPositionHours(positionId, hours, overtime = 0) {
        const existing = this.positionHours.find(ph => ph.positionId === positionId);
        if (existing) {
            existing.hours = hours;
            existing.overtimeHours = overtime;
        } else {
            this.positionHours.push({
                positionId,
                hours,
                overtimeHours: overtime
            });
        }
        this.recalculateTotals();
        return this;
    }

    recalculateTotals() {
        if (this.multiPosition && this.positionHours.length > 0) {
            this.hoursWorked = this.positionHours.reduce((sum, ph) => sum + ph.hours, 0);
            this.overtimeHours = this.positionHours.reduce((sum, ph) => sum + ph.overtimeHours, 0);
        }
        return this;
    }

    toJSON() {
        return {
            employeeId: this.employeeId,
            date: this.date,
            present: this.present,
            hoursWorked: this.hoursWorked,
            overtimeHours: this.overtimeHours,
            isHoliday: this.isHoliday,
            selectedPosition: this.selectedPosition,
            multiPosition: this.multiPosition,
            positionHours: this.positionHours,
            notes: this.notes,
            // Fase 1 (U1a): persistir/subir la frescura y el tombstone. El
            // null explícito de deletedAt importa — Firestore distingue
            // ausencia de null, y el merge por-registro chequea != null.
            updatedAt: this.updatedAt,
            deletedAt: this.deletedAt
        };
    }

    static fromJSON(json) {
        return new Attendance(json);
    }
}
