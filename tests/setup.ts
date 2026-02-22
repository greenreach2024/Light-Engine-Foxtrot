// Test setup — runs before all tests
// In a real setup, this would spin up a test DB
// For now, provide env stubs so config loads don't crash

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgres://foxtrot:foxtrot@localhost:5432/light_engine_foxtrot_test";
process.env.JWT_SECRET = "test-secret-minimum-16-chars";
