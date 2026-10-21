import '../../../p2p/MiniEmployeeProposal.js';

/**
 * Turns unlinked attendance rows (Mini rows without saEmployeeId) into the same
 * `mini-roster-proposal/v1` that the personal intake review already understands,
 * so SA can create the employee or link and update an existing one from the
 * salary and day position that Mini reported with the attendance.
 *
 * Pure: no store, DOM or network. The proposal is deterministic for the same
 * data (stable id, date and row order) so repeating the action reuses the
 * already staged proposal instead of creating a second one.
 */

const MAX_EMPLOYEES = 500;
const MAX_ID_LENGTH = 128;
const CONTROL_CHARS = /[\x00-\x1f\x7f]/g;
export const ATTENDANCE_PROPOSAL_PEER_PREFIX = 'attendance:';

const proposalContract = () => globalThis.MiniEmployeeProposal;
const clean = (value, max) => String(value ?? '').replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

export function hasEmployeeProfile(source) {
    if (!source) return false;
    return Boolean(clean(source.positionName, 80)) || Number.isFinite(source.dailySalary);
}

/** The Mini peer when known; a stable synthetic id for pasted/imported submissions. */
export function attendanceProposalPeerId(source) {
    const peer = clean(source?.sourcePeerId, MAX_ID_LENGTH).replace(/\s/g, '');
    if (peer) return peer;
    const origin = clean(source?.rawDeviceId || source?.deviceId || source?.sourceId || 'mini', MAX_ID_LENGTH).replace(/\s/g, '-');
    return `${ATTENDANCE_PROPOSAL_PEER_PREFIX}${origin}`.slice(0, MAX_ID_LENGTH);
}

function primarySource(item) {
    if (!Array.isArray(item?.sources)) return null;
    return item.sources.find(source => source && source.missingRoster !== true) || null;
}

function hash(text) {
    let value = 2166136261;
    for (let index = 0; index < text.length; index++) value = Math.imul(value ^ text.charCodeAt(index), 16777619);
    return (value >>> 0).toString(16).padStart(8, '0');
}

function newer(candidate, current) {
    return `${candidate.workDate}|${candidate.capturedAt}` > `${current.workDate}|${current.capturedAt}`;
}

function parseSalary(value) {
    if (!Number.isFinite(value)) return null;
    try { return proposalContract().parseDailySalary(value); } catch (_) { return null; }
}

function validIso(value) {
    return typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function rowFor(source) {
    return {
        miniLocalId: clean(source.miniLocalId, MAX_ID_LENGTH).replace(/\s/g, ''),
        number: clean(source.number, 32),
        name: clean(source.name, 120),
        position: clean(source.positionName, 80),
        dailySalary: parseSalary(source.dailySalary),
        phone: '',
        email: ''
    };
}

function skipReason(row) {
    if (!row.miniLocalId) return 'missing_local_id';
    if (!row.name) return 'missing_name';
    if (!/^\d+$/.test(row.number) || !Number.isSafeInteger(Number(row.number))) return 'invalid_number';
    return null;
}

/**
 * @param {Array<object>} items consolidated attendance items
 * @param {{saProjectId: string, now?: number}} options
 * @returns {{groups: Array<{peerId: string, peerName: string, proposal: object, itemIds: string[]}>, skipped: Array<{itemId: string, reason: string}>}}
 */
export function buildAttendanceEmployeeProposals(items, { saProjectId, now = Date.now() } = {}) {
    const skipped = [];
    const peers = new Map();
    for (const item of items || []) {
        if (!item || item.saEmployeeId || item.excluded) continue;
        const source = primarySource(item);
        if (!source) continue;
        const row = rowFor(source);
        const reason = skipReason(row);
        if (reason) { skipped.push({ itemId: item.id, reason }); continue; }
        const peerId = attendanceProposalPeerId(source);
        if (!peers.has(peerId)) peers.set(peerId, { peerName: clean(source.sourcePeerName || source.deviceId, 120) || 'Mini', rows: new Map(), captured: [] });
        const group = peers.get(peerId);
        const existing = group.rows.get(row.miniLocalId);
        if (!existing) group.rows.set(row.miniLocalId, { source, row, itemIds: [item.id] });
        else {
            existing.itemIds.push(item.id);
            if (newer(source, existing.source)) Object.assign(existing, { source, row });
        }
        if (validIso(source.capturedAt)) group.captured.push(source.capturedAt);
    }
    const groups = [];
    for (const [peerId, group] of peers) {
        const entries = [...group.rows.values()].sort((a, b) => Number(a.row.number) - Number(b.row.number) || a.row.miniLocalId.localeCompare(b.row.miniLocalId));
        const kept = entries.slice(0, MAX_EMPLOYEES);
        entries.slice(MAX_EMPLOYEES).forEach(entry => entry.itemIds.forEach(itemId => skipped.push({ itemId, reason: 'too_many' })));
        const employees = kept.map(entry => entry.row);
        const fingerprint = hash(JSON.stringify([saProjectId, peerId, [...employees].sort((a, b) => a.miniLocalId.localeCompare(b.miniLocalId)).map(r => [r.miniLocalId, r.number, r.name, r.position, r.dailySalary])]));
        const proposalId = `attendance-${fingerprint}`;
        const generatedAt = group.captured.sort().pop() || new Date(now).toISOString();
        const proposal = proposalContract().validateProposal({
            schema: proposalContract().SCHEMA, proposalId, requestId: proposalId, saProjectId, generatedAt,
            salaryPeriod: 'daily', currency: 'DOP', employees
        });
        groups.push({ peerId, peerName: group.peerName, proposal, itemIds: kept.flatMap(entry => entry.itemIds) });
    }
    return { groups, skipped };
}
