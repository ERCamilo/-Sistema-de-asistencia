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
            notes: this.notes
        };
    }

    static fromJSON(json) {
        return new Attendance(json);
    }
}
