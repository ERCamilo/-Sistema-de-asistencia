export class Leader {
    constructor(data) {
        this.id = data.id || `LEAD${Date.now()}`;
        this.number = data.number;
        this.name = data.name;
        this.active = data.active !== undefined ? data.active : true;
        this.phone = data.phone || '';
        this.email = data.email || '';
        this.notes = data.notes || '';
        this.createdDate = data.createdDate || new Date().toISOString();
        this.lastStatusChange = data.lastStatusChange || null;
        this.statusHistory = data.statusHistory || [];
    }

    activate() {
        this.active = true;
        this.lastStatusChange = new Date().toISOString();
        this.statusHistory.push({
            date: this.lastStatusChange,
            active: true,
            timestamp: Date.now()
        });
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
        return this;
    }

    toJSON() {
        return {
            id: this.id,
            number: this.number,
            name: this.name,
            active: this.active,
            phone: this.phone,
            email: this.email,
            notes: this.notes,
            createdDate: this.createdDate,
            lastStatusChange: this.lastStatusChange,
            statusHistory: this.statusHistory
        };
    }

    static fromJSON(json) {
        return new Leader(json);
    }
}
