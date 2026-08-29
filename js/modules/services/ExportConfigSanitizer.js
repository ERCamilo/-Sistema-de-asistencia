/**
 * 🧹 ExportConfigSanitizer.js (F1.6-A5 H-05)
 *
 * exportConfig is transient session/UI state (period selection, preview
 * inclusion, loan selection, adjustment scopes, etc.). It must NEVER be
 * persisted to the mirror, cloud replace, snapshots, or DataOps local→cloud
 * payloads, and must NEVER be resurrected on ingress (legacy cloud/snapshot
 * restore, mirror subscription, local→cloud snapshot backup).
 *
 * This module is the single frontier for that contract: every egress clones
 * then calls sanitizeExportConfig before persist/upload, and every ingress
 * calls it on the incoming payload before applying to in-memory state.
 *
 * Deleting ONLY the exportConfig property preserves legitimate durable config:
 *   - settings.payrollDefaults
 *   - projectPayrollConfigs store
 * Must NOT touch PayrollClosure/closures/loans/economic adjustments/PDF/SplitX.
 */

export function sanitizeExportConfig(stateClone) {
    if (!stateClone || typeof stateClone !== 'object') return stateClone;
    if ('exportConfig' in stateClone) delete stateClone.exportConfig;
    return stateClone;
}

export default { sanitizeExportConfig };
