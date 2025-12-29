// CORS middleware configuration
// Allowed origins for production (S3 frontend + Elastic Beanstalk backend + Custom Domain)
const ALLOWED_ORIGINS = [
  'http://light-engine-demo-1765326376.s3-website-us-east-1.amazonaws.com',
  'http://light-engine-foxtrot-prod.eba-ukiyyqf9.us-east-1.elasticbeanstalk.com',
  'https://light-engine-demo-1765326376.s3-website-us-east-1.amazonaws.com',
  'https://light-engine-foxtrot-prod.eba-ukiyyqf9.us-east-1.elasticbeanstalk.com',
  'http://greenreachgreens.com',  // Greenreach production domain (marketing/wholesale)
  'https://greenreachgreens.com',  // Greenreach production domain (HTTPS)
  'http://www.greenreachgreens.com',  // Greenreach with www
  'https://www.greenreachgreens.com',  // Greenreach with www (HTTPS)
  'http://urbanyeild.ca',  // Light Engine production domain (farm monitoring/automation)
  'https://urbanyeild.ca',  // Light Engine production domain (HTTPS)
  'http://www.urbanyeild.ca',  // Light Engine with www
  'https://www.urbanyeild.ca',  // Light Engine with www (HTTPS)
  'http://localhost:8091',  // Local development
  'http://127.0.0.1:8091',  // Local development
];

export function setCorsHeaders(req, res, next) {
  const origin = req.headers.origin;
  
  // Check if origin is in allowed list
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else if (!origin || process.env.NODE_ENV !== 'production') {
    // Allow requests with no origin (same-origin) or in development
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
  } else {
    // Production: reject unknown origins
    console.warn('[CORS] Rejected request from origin:', origin);
  }
  
  // Allow common HTTP methods
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
  
  // Allow common headers
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  
  // Allow credentials (cookies, auth headers)
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  
  next();
}