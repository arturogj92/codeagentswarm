// Mock for better-sqlite3 to avoid native binding issues in tests
module.exports = jest.fn(() => ({
  prepare: jest.fn(() => ({
    run: jest.fn(),
    get: jest.fn(),
    all: jest.fn()
  })),
  exec: jest.fn(),
  close: jest.fn(),
  pragma: jest.fn()
}));