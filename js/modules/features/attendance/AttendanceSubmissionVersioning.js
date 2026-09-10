function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
}

function stableRows(snapshot) {
    const rows = Array.isArray(snapshot?.rows) ? snapshot.rows : [];
    return rows.map(row => ({
        identity: String(row.saEmployeeId || `mini:${row.miniLocalId || ''}`),
        saEmployeeId: row.saEmployeeId || null,
        miniLocalId: row.miniLocalId || null,
        number: String(row.number || ''),
        name: String(row.name || ''),
        status: row.status || 'unmarked',
        rosterStatus: row.rosterStatus || 'active',
        normalHours: Number(row.normalHours || 0),
        overtimeHours: Number(row.overtimeHours || 0)
    })).sort((a, b) => a.identity.localeCompare(b.identity));
}

function canonical(value) {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

function fnv1a32(text) {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i += 1) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
    return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function attendanceSubmissionSemanticHash(snapshot) {
    return fnv1a32(canonical({
        saProjectId: snapshot?.saProjectId || null,
        workDate: snapshot?.workDate || null,
        coverageMode: snapshot?.coverageMode || null,
        rows: stableRows(snapshot)
    }));
}

export function attendanceSubmissionSeriesKey(snapshot, sourceIdentity = null) {
    const source = sourceIdentity || snapshot?.deviceId;
    if (!snapshot?.saProjectId || !source || !snapshot?.workDate) {
        throw new TypeError('saProjectId, source identity and workDate are required for version series');
    }
    return [snapshot.saProjectId, source, snapshot.workDate]
        .map(value => encodeURIComponent(String(value))).join('|');
}

export function diffAttendanceSubmissionSnapshots(original, current) {
    const before = new Map(stableRows(original).map(row => [row.identity, row]));
    const after = new Map(stableRows(current).map(row => [row.identity, row]));
    const identities = [...new Set([...before.keys(), ...after.keys()])].sort();
    const summary = {
        hoursChanged: 0,
        attendanceAdded: 0,
        attendanceRemoved: 0,
        activated: 0,
        paused: 0,
        employeesAdded: 0,
        employeesRemoved: 0,
        totalChanges: 0
    };
    const details = [];

    for (const identity of identities) {
        const a = before.get(identity) || null;
        const b = after.get(identity) || null;
        const types = [];
        if (!a && b) {
            summary.employeesAdded += 1;
            types.push('employee_added');
        } else if (a && !b) {
            summary.employeesRemoved += 1;
            types.push('employee_removed');
        }
        const beforeHours = a ? a.normalHours + a.overtimeHours : 0;
        const afterHours = b ? b.normalHours + b.overtimeHours : 0;
        const beforeHasAttendance = Boolean(a && a.status === 'present' && beforeHours > 0);
        const afterHasAttendance = Boolean(b && b.status === 'present' && afterHours > 0);
        if (!beforeHasAttendance && afterHasAttendance) {
            summary.attendanceAdded += 1;
            types.push('attendance_added');
        } else if (beforeHasAttendance && !afterHasAttendance) {
            summary.attendanceRemoved += 1;
            types.push('attendance_removed');
        } else if (beforeHasAttendance && afterHasAttendance && beforeHours !== afterHours) {
            summary.hoursChanged += 1;
            types.push('hours_changed');
        }
        const beforeRoster = a?.rosterStatus || null;
        const afterRoster = b?.rosterStatus || null;
        if (beforeRoster === 'paused' && afterRoster === 'active') {
            summary.activated += 1;
            types.push('activated');
        } else if (beforeRoster === 'active' && afterRoster === 'paused') {
            summary.paused += 1;
            types.push('paused');
        }
        if (!types.length) continue;
        summary.totalChanges += 1;
        details.push({
            identity,
            saEmployeeId: b?.saEmployeeId || a?.saEmployeeId || null,
            number: b?.number || a?.number || '',
            name: b?.name || a?.name || '',
            types,
            beforeHours,
            afterHours,
            deltaHours: afterHours - beforeHours,
            beforeRosterStatus: beforeRoster,
            afterRosterStatus: afterRoster,
            beforeStatus: a?.status || null,
            afterStatus: b?.status || null
        });
    }
    return Object.freeze({
        changed: summary.totalChanges > 0,
        semanticHashOriginal: attendanceSubmissionSemanticHash(original),
        semanticHashCurrent: attendanceSubmissionSemanticHash(current),
        summary: Object.freeze(summary),
        details: Object.freeze(details.map(item => Object.freeze(clone(item))))
    });
}
