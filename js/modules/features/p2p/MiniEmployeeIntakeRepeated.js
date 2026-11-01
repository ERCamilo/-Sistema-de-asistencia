import { employeeNumberIdentityKey } from '../employees/EmployeeNumberIdentity.js';
import { normalizePersonName } from '../projects/ProjectDuplicateCandidates.js';
import { proposalContract } from './MiniEmployeeIntake.js';

const nameKey = name => normalizePersonName(name).split(' ').sort().join(' ');
/** Same person across origins: same number and same name (case, accents and word order ignored). */
export const personKey = row => `${employeeNumberIdentityKey(row.number)}|${nameKey(row.name)}`;

/**
 * Employees just resolved in `origin` that are repeated in other pending proposals of the
 * ledger are marked resolved there too, with the same SA employee. Mutates the ledger.
 * A proposal whose result would be invalid is left untouched.
 */
export function resolveRepeatedEmployees(ledger, origin, resolvedMappings, linkId) {
    const byPerson = new Map();
    for (const mapping of resolvedMappings) {
        const row = origin.payload.employees.find(candidate => candidate.miniLocalId === mapping.miniLocalId);
        if (row) byPerson.set(personKey(row), mapping);
    }
    const project = origin.payload.saProjectId, resolved = [];
    for (const other of ledger.items) {
        if (other === origin || other.status !== 'pending' || other.payload.saProjectId !== project) continue;
        const mapped = new Set(other.mappings.map(mapping => mapping.miniLocalId));
        const taken = new Set(other.mappings.map(mapping => mapping.saEmployeeId));
        const added = [];
        for (const row of other.payload.employees) {
            if (mapped.has(row.miniLocalId) || ledger.links[linkId(other.peerId, project, row.miniLocalId)]) continue;
            const match = byPerson.get(personKey(row));
            if (!match || taken.has(match.saEmployeeId)) continue;
            taken.add(match.saEmployeeId);
            added.push({ ...match, miniLocalId: row.miniLocalId });
        }
        if (!added.length) continue;
        try {
            const result = proposalContract.validateResult({ schema: 'mini-roster-result/v1', proposalId: other.payload.proposalId, saProjectId: project, mappings: [...other.mappings, ...added] }, other.payload);
            other.mappings = result.mappings;
            other.result = result;
            other.status = result.mappings.length === other.payload.employees.length ? 'resolved' : 'pending';
            other.updatedAt = Date.now();
            added.forEach(mapping => { ledger.links[linkId(other.peerId, project, mapping.miniLocalId)] = mapping; });
            resolved.push({ entry: other, added });
        } catch (_) { /* leave that proposal for manual review */ }
    }
    return resolved;
}
