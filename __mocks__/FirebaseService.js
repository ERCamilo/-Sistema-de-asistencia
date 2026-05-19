/**
 * Mock de FirebaseService.js
 */
const FirebaseService = {
    saveFullState: jest.fn().mockResolvedValue(undefined),
    loadFullState: jest.fn().mockResolvedValue(null),
    signIn: jest.fn().mockResolvedValue(null),
    signOut: jest.fn().mockResolvedValue(undefined),
    onAuthStateChanged: jest.fn(),
    listenToAttendance: jest.fn().mockReturnValue(() => {}),
    listenToEmployees: jest.fn().mockReturnValue(() => {}),
    saveAttendanceBatch: jest.fn().mockResolvedValue(undefined),
    user: null
};

export default FirebaseService;
