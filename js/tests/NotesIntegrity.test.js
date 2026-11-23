import fs from 'fs';
import { state, stateManager } from '../modules/core/AppState.js';
import { getDateKey } from '../modules/utils/DateUtils.js';
import { mergeAttendanceRecords } from '../modules/features/attendance/AttendanceMerge.js';
import { attendanceNoteFields, stampAttendanceWrite, tombstoneAttendanceWrite } from '../modules/features/attendance/AttendanceRecordWriter.js';
import { upsertNote, clearNote } from '../modules/features/notes/NotesService.js';
import { NotesCenter } from '../modules/features/notes/NotesCenter.js';
import { closeNoteModal, deleteNoteModal, loadNotesHistory, openNewNote, openNoteEditor, openVoiceNoteDraft, saveNoteModal, setNoteModalDate, setNoteModalText } from '../modules/features/notes/NotesController.js';
import { ensureAllAttendanceHistory, saveApplicationData } from '../modules/services/PersistenceService.js';

jest.mock('../modules/services/PersistenceService.js', () => ({
    ensureAllAttendanceHistory: jest.fn(),
    ensureAttendanceRange: jest.fn(),
    saveApplicationData: jest.fn()
}));

const day = getDateKey(new Date());
const key = `a-${day}`;
const other = '2026-01-01';
const otherKey = `a-${other}`;
beforeEach(() => {
    closeNoteModal();
    stateManager.batchSetState(() => {
        state.employees = [{ id: 'a', name: 'Ana' }];
        state.attendance = {};
        state.showNotesCenter = true;
        state.notesCenterEmployeeId = 'a';
    });
    saveApplicationData.mockReset();
    window.showConfirm = ({ onConfirm }) => onConfirm();
    window.showNotification = jest.fn();
});

test('new notes append and enqueue the day, while editing and deleting keep the original date', async () => {
    upsertNote(state, 'a', day, 'Primera');
    upsertNote(state, 'a', other, 'Otra fecha');
    openNewNote('a');
    setNoteModalText('Segunda');
    await saveNoteModal();
    expect(state.attendance[key].notes).toBe('Primera\nSegunda');
    expect(saveApplicationData).toHaveBeenLastCalledWith({ dateKey: day, announce: 'Nota guardada' });
    openNoteEditor('a', day);
    setNoteModalDate(other);
    setNoteModalText('Editada');
    await saveNoteModal();
    expect(state.attendance[key].notes).toBe('Editada');
    openNoteEditor('a', day);
    setNoteModalDate(other);
    deleteNoteModal();
    expect(state.attendance[key].notes).toBe('');
    expect(state.attendance[otherKey].notes).toBe('Otra fecha');
    expect(saveApplicationData).toHaveBeenLastCalledWith({ dateKey: day, announce: 'Nota eliminada' });
});

test('an edit cannot accidentally overwrite a newly synced note', async () => {
    upsertNote(state, 'a', day, 'Anterior');
    openNoteEditor('a', day);
    upsertNote(state, 'a', day, 'Dato sincronizado');
    setNoteModalText('Edición con una copia anterior');
    await saveNoteModal();
    expect(state.attendance[key].notes).toBe('Dato sincronizado');
    expect(saveApplicationData).not.toHaveBeenCalled();
});

test('voice completion waits for local persistence and a failed save can be retried once', async () => {
    const context = { employeeId:'a', uid:'u', requestId:'r', draft:{text:'Dictado',date:day}, guard:jest.fn(), onSaved:jest.fn() };
    openVoiceNoteDraft('a', context);
    saveApplicationData.mockResolvedValueOnce({localOk:false}).mockResolvedValueOnce({localOk:true});
    const firstSave = saveNoteModal();
    expect(context.onSaved).not.toHaveBeenCalled();
    await firstSave;
    expect(state.showNoteModal).toBe(true);
    expect(state.attendance[key]).toBeUndefined();
    await saveNoteModal();
    expect(state.attendance[key].notes).toBe('Dictado');
    expect(context.onSaved).toHaveBeenCalledTimes(1);
    expect(saveApplicationData).toHaveBeenLastCalledWith(expect.objectContaining({ dateKey:day, immediate:true, requireLocalSuccess:true }));
});

test('archival history can be reloaded and note text remains literal in both views', async () => {
    expect(NotesCenter()).toContain('Cargar historial de notas');
    ensureAllAttendanceHistory.mockImplementationOnce(async () => {
        upsertNote(state, 'a', '2024-01-01', '<b>Nota antigua</b>');
    });
    await loadNotesHistory();
    for (const selectedId of ['a',null]) {
        state.notesCenterEmployeeId = selectedId;
        const container = document.createElement('div');
        container.innerHTML = NotesCenter();
        expect(container.querySelector('b')).toBeNull();
        expect(container.textContent).toContain('<b>Nota antigua</b>');
    }
});

test('merging a note and changed hours combines both in either direction, including note deletion', () => {
    const baseline = { employeeId:'a', date:day, notes:'Antes', hoursWorked:8, updatedAt:1 };
    state.attendance[key] = baseline;
    const note = upsertNote(state, 'a', day, 'Conservar');
    const hours = { ...baseline, hoursWorked:6, updatedAt:2 };
    for (const [local, remote] of [[note,hours],[hours,note]]) {
        expect(mergeAttendanceRecords({[key]:local},{[key]:remote})[key]).toMatchObject({hoursWorked:6,notes:'Conservar'});
    }
    clearNote(state, 'a', day);
    const removal = state.attendance[key];
    expect(mergeAttendanceRecords({[key]:removal},{[key]:{...note,updatedAt:3}})[key].notes).toBe('');
    expect(mergeAttendanceRecords({[key]:note},{[key]:{...hours,projectId:'other'}})[key].notes).toBe('Antes');
});

test('marking and unmarking attendance preserve versioned notes and voice provenance', () => {
    upsertNote(state, 'a', day, 'Observación', {voiceSource:{voiceRequestId:'r',voiceActorUid:'u'}});
    const source = fs.readFileSync('js/app.js','utf8');
    const start = source.indexOf('window.toggleAttendance =');
    const end = source.indexOf('function updateCheckboxOnly',start);
    const noop = () => {};
    const api = {};
    new Function('window','state','attendanceNoteFields','getDateKey','getDayHours','getActivePayrollSettings','isDayHoliday','stampAttendanceWrite','tombstoneAttendanceWrite','UndoManager','invalidateEmployeeStats','buildAttendanceIndex','saveApplicationData','perfMonitor','render',source.slice(start,end))(
        api,state,attendanceNoteFields,getDateKey,()=>8,()=>({}),()=>false,stampAttendanceWrite,tombstoneAttendanceWrite,{push:noop},noop,noop,noop,{start:noop,end:noop},noop
    );
    state.viewMode = 'compact';
    api.toggleAttendance('a',day);
    expect(state.attendance[key]).toMatchObject({present:true,hoursWorked:8,notes:'Observación',voiceNoteRequests:[{voiceRequestId:'r',voiceActorUid:'u'}]});
    api.toggleAttendance('a',day);
    expect(state.attendance[key].present).toBe(false);
    expect(NotesCenter()).toContain('Observación');
});
