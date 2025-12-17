// CORS middleware configuration
export function setCorsHeaders(req, res, next) {
  // Allow requests from any origin in development
  // In production, this should be restricted to specific origins
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  // Allow common HTTP methods
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  
  // Allow common headers
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  
  next();
}