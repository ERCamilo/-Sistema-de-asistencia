export class Position {
    constructor(data) {
        this.id = data.id || `POS${Date.now()}`;
        this.name = data.name;
        this.color = data.color;
        this.icon = data.icon || null;
        this.active = data.active !== undefined ? data.active : true;
        this.salaryConfig = data.salaryConfig || {
            amount: data.baseSalary || 0,
            period: 'day',
            workDays: []
        };
        this.baseSalary = this.salaryConfig.amount; // Compatibilidad
        this.workingDays = data.workingDays || [1, 2, 3, 4, 5]; // Lun-Vie por defecto (0=Dom, 1=Lun, ...)
        this.hourlyRate = data.hourlyRate || 0; // ⚡ NUEVO: Tarifa por hora
        // ⚡ Aditivo: en qué modo se cargó la tarifa ('hourly' | 'daily'). Solo afecta
        // cómo se MUESTRA/edita; lo guardado en hourlyRate sigue siendo por hora.
        this.salaryInputMode = data.salaryInputMode === 'daily' ? 'daily' : 'hourly';
        this.leaderId = data.leaderId || null; // ⚡ NUEVO: ID del líder responsable
        this.lastStatusChange = data.lastStatusChange || null;
        this.statusHistory = data.statusHistory || [];
        this.updatedAt = data.updatedAt || Date.now();
        // F1.4: proyecto propietario (F0.4 §2 — ausente/null ⇒ predeterminado).
        // Sólo se conserva si la clave existe (byte-estable para legacy).
        if (Object.prototype.hasOwnProperty.call(data, 'projectId')) {
            this.projectId = data.projectId ?? null;
        }
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
        const json = {
            id: this.id,
            name: this.name,
            color: this.color,
            icon: this.icon,
            active: this.active,
            salaryConfig: this.salaryConfig, // ⚡ CRÍTICO: Re-habilitado para persistencia
            baseSalary: this.baseSalary,
            hourlyRate: this.hourlyRate,
            salaryInputMode: this.salaryInputMode,
            leaderId: this.leaderId,
            workingDays: this.workingDays,
            lastStatusChange: this.lastStatusChange,
            statusHistory: this.statusHistory,
            updatedAt: this.updatedAt
        };
        if (Object.prototype.hasOwnProperty.call(this, 'projectId')) {
            json.projectId = this.projectId;
        }
        return json;
    }
    static fromJSON(json) {
        return new Position(json);
    }
}
