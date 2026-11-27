import { state, stateManager } from '../modules/core/AppState.js';
import { Attendance } from '../modules/features/attendance/Attendance.js';
import { mergeAttendanceRecords } from '../modules/features/attendance/AttendanceMerge.js';
import { attendanceNoteFields } from '../modules/features/attendance/AttendanceRecordWriter.js';
import { readNoteCard, updateNoteCard, visibleNoteText } from '../modules/features/notes/NoteCardState.js';
import { filterNotesCards, readNotesCards } from '../modules/features/notes/NotesCenterModel.js';
import { actOnNoteCard, closeNotesCenter, openNotesCenter, undoNoteCard } from '../modules/features/notes/NotesController.js';
import { saveApplicationData } from '../modules/services/PersistenceService.js';

jest.mock('../modules/services/PersistenceService.js', () => ({ saveApplicationData: jest.fn() }));

const day = '2026-11-18';
const key = `employee-${day}`;
const legacy = { employeeId: 'employee', date: day, present: true, hoursWorked: 8, updatedAt: 1, notes: 'Recibió herramientas' };
const employee = { id: 'employee', name: 'Ana Méndez', number: '0001' };

beforeEach(() => {
    closeNotesCenter();
    stateManager.batchSetState(() => {
        state.employees = [employee];
        state.attendance = {[key]: legacy};
    });
    saveApplicationData.mockClear();
});

test('legacy note appears as an active card without rewriting its record', () => {
    const cards = readNotesCards(state);
    expect(filterNotesCards(cards, {folder:'active',search:'mendez'})).toHaveLength(1);
    expect(filterNotesCards(cards, {folder:'active',search:'recibio herramientas'})).toHaveLength(1);
    expect(state.attendance[key].noteCard).toBeUndefined();
    expect(saveApplicationData).not.toHaveBeenCalled();
});

test('pin and trash can be undone while keeping the text and attendance durable', () => {
    openNotesCenter();
    const id = readNotesCards(state)[0].key;
    actOnNoteCard(id, 'pin');
    expect(readNoteCard(state.attendance[key]).pinned).toBe(true);
    actOnNoteCard(id, 'trash');
    expect(visibleNoteText(state.attendance[key])).toBe('');
    expect(state.attendance[key]).toMatchObject({notes:legacy.notes, hoursWorked:8, present:true});
    expect(saveApplicationData).toHaveBeenLastCalledWith({dateKey:day, immediate:true});
    undoNoteCard();
    expect(readNoteCard(state.attendance[key])).toMatchObject({folder:'active',pinned:true});
    actOnNoteCard(id, 'archive');
    expect(readNoteCard(state.attendance[key]).folder).toBe('archive');
    expect(visibleNoteText(state.attendance[key])).toBe(legacy.notes);
});

test('undo leaves a newer remote filing untouched', () => {
    openNotesCenter();
    actOnNoteCard(readNotesCards(state)[0].key, 'archive');
    state.attendance[key] = updateNoteCard(state.attendance[key], {folder:'trash'});
    undoNoteCard();
    expect(readNoteCard(state.attendance[key]).folder).toBe('trash');
});

test('filing survives the attendance serializer, re-marking attendance and sync in either order', () => {
    const filed = updateNoteCard({...legacy,noteUpdatedAt:1,voiceNoteRequests:[{voiceRequestId:'voice-one'}]}, {folder:'archive'}, 4);
    const roundTrip = JSON.parse(JSON.stringify(new Attendance(filed)));
    expect(roundTrip.noteCard).toEqual(filed.noteCard);
    expect(roundTrip.voiceNoteRequests).toEqual(filed.voiceNoteRequests);
    expect(attendanceNoteFields(roundTrip).noteCard).toEqual(filed.noteCard);
    const remote = {...legacy,hoursWorked:6,notes:'Texto editado',updatedAt:5,noteUpdatedAt:5};
    for (const [local,incoming] of [[roundTrip,remote],[remote,roundTrip]]) {
        const merged = mergeAttendanceRecords({[key]:local},{[key]:incoming})[key];
        expect(merged).toMatchObject({hoursWorked:6,notes:'Texto editado',noteCard:filed.noteCard});
    }
});
