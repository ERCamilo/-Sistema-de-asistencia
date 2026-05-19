/**
 * 📝 Notes feature — public exports.
 *
 * Sprint 3 (2026-05-19): extracted from app.js. The data layer, controller
 * handlers, and UI templates each live in their own file. Importers only
 * need this index.
 */

export { upsertNote, clearNote, listNotes } from './NotesService.js';

export {
    openNotesCenter,
    closeNotesCenter,
    selectNotesEmployee,
    backToNotesList,
    openNoteEditor,
    openNewNote,
    closeNoteModal,
    setNoteModalText,
    setNoteModalDate,
    saveNoteModal,
    deleteNoteModal,
    registerLegacyGlobals
} from './NotesController.js';

export { NotesCenter } from './NotesCenter.js';
export { NoteEditorModal } from './NoteEditorModal.js';
