// Test setup — no DB connection needed for unit tests
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-for-unit-tests-only';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
