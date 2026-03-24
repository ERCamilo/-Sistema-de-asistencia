export class Position {
    constructor(data) {
        this.id = data.id || `POS${Date.now()}`;
        this.name = data.name;
        this.color = data.color;
        this.active = data.active !== undefined ? data.active : true;
        this.salaryConfig = data.salaryConfig || {
            amount: data.baseSalary || 0,
            period: 'day',
            workDays: []
        };
        this.baseSalary = this.salaryConfig.amount; // Compatibilidad
        this.workingDays = data.workingDays || [1, 2, 3, 4, 5]; // Lun-Vie por defecto (0=Dom, 1=Lun, ...)
        this.hourlyRate = data.hourlyRate || 0; // ⚡ NUEVO: Tarifa por hora
        this.leaderId = data.leaderId || null; // ⚡ NUEVO: ID del líder responsable
        this.lastStatusChange = data.lastStatusChange || null;
        this.statusHistory = data.statusHistory || [];
        this.updatedAt = data.updatedAt || Date.now();
    }

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

    toJSON() {
        return {
            id: this.id,
            name: this.name,
            color: this.color,
            active: this.active,
            salaryConfig: this.salaryConfig, // ⚡ CRÍTICO: Re-habilitado para persistencia
            baseSalary: this.baseSalary,
            hourlyRate: this.hourlyRate, 
            leaderId: this.leaderId,
            workingDays: this.workingDays,
            lastStatusChange: this.lastStatusChange,
            statusHistory: this.statusHistory,
            updatedAt: this.updatedAt
        };
    }

    static fromJSON(json) {
        return new Position(json);
    }
}
