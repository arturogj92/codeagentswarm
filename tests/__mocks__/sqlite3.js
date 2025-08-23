// Mock for sqlite3 to avoid native binding issues in tests
module.exports = {
  Database: jest.fn(),
  OPEN_READWRITE: 2,
  OPEN_CREATE: 4,
  verbose: jest.fn(() => module.exports)
};