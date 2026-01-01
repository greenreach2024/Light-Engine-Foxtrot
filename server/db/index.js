/**
 * Database connection stub
 * Provides a mock database interface for multi-tenant middleware
 */

let dbConnection = null;

export function getDb() {
  if (!dbConnection) {
    // Return a mock db interface that allows the server to start
    // In multi-tenant mode with no database, we'll allow all tenants through
    dbConnection = {
      query: async (sql, params) => {
        console.log('[DB STUB] Query:', sql, params);
        
        // Mock response for tenant validation
        if (sql.includes('tenants')) {
          return {
            rows: [{
              id: 1,
              name: 'Default Farm',
              active: true,
              subdomain: params[0] || 'default'
            }]
          };
        }
        
        // Default empty response
        return { rows: [] };
      }
    };
  }
  
  return dbConnection;
}

export function initDb(config) {
  console.log('[DB] Database connection stub initialized');
  return Promise.resolve();
}

export default { getDb, initDb };
