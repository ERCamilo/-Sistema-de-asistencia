/**
 * Mock de IndexedDBService.js
 */
const indexedDBService = {
    saveState: jest.fn().mockResolvedValue(undefined),
    loadState: jest.fn().mockResolvedValue(null),
    clearAll: jest.fn().mockResolvedValue(undefined),
    isAvailable: jest.fn().mockReturnValue(true)
};

export const IndexedDBService = indexedDBService;
export default indexedDBService;
