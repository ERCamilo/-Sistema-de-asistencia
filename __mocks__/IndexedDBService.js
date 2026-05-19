/**
 * Mock for IndexedDBService.js
 * All methods are jest.fn() so individual tests can override behavior with
 * mockResolvedValueOnce / mockReturnValueOnce.
 */
const indexedDBService = {
    saveState: jest.fn().mockResolvedValue(undefined),
    loadState: jest.fn().mockResolvedValue(null),
    loadFullState: jest.fn().mockResolvedValue(null),
    clear: jest.fn().mockResolvedValue(undefined),
    clearAll: jest.fn().mockResolvedValue(undefined),
    isSupported: jest.fn().mockReturnValue(true),
    isAvailable: jest.fn().mockReturnValue(true)
};

export const IndexedDBService = indexedDBService;
export default indexedDBService;
