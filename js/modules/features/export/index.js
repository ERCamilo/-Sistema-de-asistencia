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
    showExportMenuHandler,
    closeExportMenuHandler,
    toggleShareOptions,
    performShare,
    performDownload,
    shareExportFull,
    shareExportMini,
    openImportFullModal,
    closeImportFullModal,
    setImportFullText,
    confirmImportFull,
    registerLegacyGlobals
} from './ExportController.js';

export { ExportMenu } from './ExportMenu.js';
export { ImportFullModal } from './ImportFullModal.js';
