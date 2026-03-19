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
        this.notes = data.notes || '';
        this.customWorkingDays = data.customWorkingDays || {}; // { positionId: [1,2,3,4,5] }
        this.createdDate = data.createdDate || new Date().toISOString();
        this.lastStatusChange = data.lastStatusChange || null;
        this.statusHistory = data.statusHistory || [];
        this.updatedAt = data.updatedAt || Date.now();
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
            active: this.active,
            hireDate: this.hireDate,
            phone: this.phone,
            email: this.email,
            notes: this.notes,
            createdDate: this.createdDate,
            lastStatusChange: this.lastStatusChange,
            statusHistory: this.statusHistory,
            updatedAt: this.updatedAt
        };
    }

    static fromJSON(json) {
        return new Employee(json);
    }
}
