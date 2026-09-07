/**
 * 📤 Export feature — public exports.
 *
 * Sprint 4 (2026-05-19): full extraction from app.js.
 * ExportMenuService (pure state ops) was created in Sprint 2.
 */

export {
    openExportMenu,
    closeExportMenu,
    canShareFiles,
    buildMiniExportPayload,
    EMPTY_EXPORT_DATA
} from './ExportMenuService.js';

export {
    SA_MINI_ROSTER_SCHEMA,
    SA_MINI_ROSTER_VERSION,
    SA_MINI_ROSTER_ENVELOPE_KEYS,
    SA_MINI_ROSTER_ROW_KEYS,
    SA_MINI_ID_MAX_LENGTH,
    SaMiniRosterExportError,
    normalizeRosterNumber,
    normalizeSaMiniId,
    resolveSaMiniRosterScope,
    selectSaMiniRosterEmployees,
    buildSaMiniRosterPayload,
    buildSaMiniRosterJson
} from './SaMiniRosterExport.js';

export {
    showExportMenuHandler,
    closeExportMenuHandler,
    toggleShareOptions,
    performShare,
    performDownload,
    shareExportFull,
    shareExportMini,
    shareExportMiniV1,
    toggleMiniV1Salary,
    setMiniV1IncludeSalary,
    openImportFullModal,
    closeImportFullModal,
    setImportFullText,
    confirmImportFull,
    registerLegacyGlobals
} from './ExportController.js';

export { ExportMenu } from './ExportMenu.js';
export { ImportFullModal } from './ImportFullModal.js';
