import { entityInScope, peekEntityScope } from '../projects/EntityProjectScope.js';
import { listNotes } from './NotesService.js';
import { readNoteCard } from './NoteCardState.js';

export const notesCardKey = (record) => JSON.stringify([String(record.employeeId), record.date]);

export function notesEmployees(state, scope = peekEntityScope()) {
    return (state.employees || []).filter(employee => entityInScope(employee, scope));
}

export function readNotesCards(state, scope = peekEntityScope()) {
    const employees = new Map(notesEmployees(state, scope).map(employee => [String(employee.id), employee]));
    return listNotes(state).filter(record => entityInScope(record, scope) && employees.has(String(record.employeeId)))
        .map(record => ({ key: notesCardKey(record), record, employee: employees.get(String(record.employeeId)), ...readNoteCard(record) }))
        .sort((a, b) => Number(b.pinned) - Number(a.pinned) || (b.record.date || '').localeCompare(a.record.date || ''));
}

const normalize = value => String(value ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
export function filterNotesCards(cards, { folder, search, employeeId }) {
    const query = normalize(search).trim();
    return cards.filter(card => card.folder === folder &&
        (!employeeId || String(card.employee.id) === String(employeeId)) &&
        (!query || normalize([card.employee.name, card.employee.number, card.record.notes].join(' ')).includes(query)));
}
