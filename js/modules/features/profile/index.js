/**
 * 👤 Profile feature — public exports.
 *
 * Sprint 6 (2026-05-19): full extraction from app.js.
 */

export { EmployeeProfileModal } from './EmployeeProfileModal.js';

export {
    ProfileTabResumen,
    ProfileTabNomina,
    ProfileTabAsistencia,
    ProfileTabDocumentos
} from './ProfileTabs.js';

export {
    ProfileStartDatePicker,
    ProfileEndDatePicker,
    ProfileHireDatePicker,
    calculateMonthlyEstimate
} from './ProfilePickers.js';

export {
    closeEmployeeProfile,
    changeProfileTab,
    changeProfileHireDateMonth,
    selectProfileHireDate,
    toggleProfileStartPicker,
    toggleProfileEndPicker,
    changeProfileStartMonth,
    changeProfileEndMonth,
    changeProfileAsistenciaMonth,
    selectProfileStartDate,
    selectProfileEndDate,
    setProfilePeriod,
    togglePositionBreakdown,
    markAsPaid,
    syncProfileToMaster,
    registerLegacyGlobals
} from './ProfileController.js';
