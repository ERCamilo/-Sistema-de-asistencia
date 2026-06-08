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
    isAvailable: jest.fn().mockReturnValue(true),
    // Comprobantes de caja chica (v9)
    saveReceipt: jest.fn().mockResolvedValue(true),
    getReceipt: jest.fn().mockResolvedValue(null),
    deleteReceipt: jest.fn().mockResolvedValue(true),
    listPendingReceipts: jest.fn().mockResolvedValue([])
};

export const IndexedDBService = indexedDBService;
export default indexedDBService;
