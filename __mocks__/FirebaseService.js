/**
 * Mock for FirebaseService.js
 */
const FirebaseService = {
    saveFullState: jest.fn().mockResolvedValue(undefined),
    loadFullState: jest.fn().mockResolvedValue(null),
    saveDailyAttendance: jest.fn().mockResolvedValue(undefined),
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
