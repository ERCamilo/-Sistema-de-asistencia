export class Leader {
    constructor(data) {
        this.id = data.id || `LEAD${Date.now()}`;
        this.number = data.number;
        this.name = data.name;
        this.icon = data.icon || null;
        this.active = data.active !== undefined ? data.active : true;
        this.phone = data.phone || '';
        this.email = data.email || '';
        this.notes = data.notes || '';
        this.createdDate = data.createdDate || new Date().toISOString();
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
            number: this.number,
            name: this.name,
            icon: this.icon,
            active: this.active,
            phone: this.phone,
            email: this.email,
            notes: this.notes,
            createdDate: this.createdDate,
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
        return new Leader(json);
    }
}
