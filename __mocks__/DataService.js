/**
 * Mock for DataService.js (legacy localStorage adapter)
 */
const dataService = {
    save: jest.fn().mockResolvedValue(undefined),
    load: jest.fn().mockResolvedValue(null),
    clear: jest.fn().mockResolvedValue(undefined),
    saveAll: jest.fn(),
    loadAll: jest.fn().mockReturnValue(false)
};

export default dataService;
