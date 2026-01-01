// Database stub for cloud deployment (no PostgreSQL available)
// This provides a mock implementation to prevent import errors

const mockPool = {
  query: async (text, params) => {
    console.log('[DB STUB] Query called:', text?.substring(0, 100), params);
    // Return empty results
    return {
      rows: [],
      rowCount: 0,
      command: 'SELECT',
      oid: null,
      fields: []
    };
  },
  connect: async () => {
    console.log('[DB STUB] Connection requested');
    return {
      query: mockPool.query,
      release: () => console.log('[DB STUB] Connection released')
    };
  },
  end: async () => {
    console.log('[DB STUB] Pool closed');
  }
};

// Export as default for routes/activity-hub-orders.js
export default mockPool;

// Also export named functions for other routes
export async function query(text, params) {
  console.log('[DB STUB] Named query called:', text?.substring(0, 100), params);
  return {
    rows: [],
    rowCount: 0
  };
}

export async function getClient() {
  console.log('[DB STUB] getClient called');
  return {
    query: mockPool.query,
    release: () => console.log('[DB STUB] Client released')
  };
}

export async function initDatabase() {
  console.log('[DB STUB] initDatabase called - skipping in cloud mode');
  return true;
}
