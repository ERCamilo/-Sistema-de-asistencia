/**
 * Mock for FirebaseService.js
 */
const FirebaseService = {
    saveFullState: jest.fn().mockResolvedValue(undefined),
    loadFullState: jest.fn().mockResolvedValue(null),
    saveDailyAttendance: jest.fn().mockResolvedValue(undefined),
    saveEntities: jest.fn().mockResolvedValue(undefined),
    saveSettings: jest.fn().mockResolvedValue(undefined),
    getSettings: jest.fn().mockResolvedValue(null),
    subscribeToSettings: jest.fn().mockReturnValue(() => {}),
    createSnapshot: jest.fn().mockResolvedValue(undefined),
    signIn: jest.fn().mockResolvedValue(null),
    signOut: jest.fn().mockResolvedValue(undefined),
    onAuthStateChanged: jest.fn(),
    listenToAttendance: jest.fn().mockReturnValue(() => {}),
    listenToEmployees: jest.fn().mockReturnValue(() => {}),
    saveAttendanceBatch: jest.fn().mockResolvedValue(undefined),
    deleteCloudData: jest.fn().mockResolvedValue({ deleted: 0 }),
    replaceCloudFull: jest.fn().mockResolvedValue(undefined),
    user: null
};

export default FirebaseService;
