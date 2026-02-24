// CORS middleware configuration
// Allowed origins for production (S3 frontend + Elastic Beanstalk backend + Custom Domain)
const ALLOWED_ORIGINS = [
  'http://light-engine-demo-1765326376.s3-website-us-east-1.amazonaws.com',
  'http://light-engine-foxtrot-prod.eba-ukiyyqf9.us-east-1.elasticbeanstalk.com',
  'http://light-engine-foxtrot-prod-v2.eba-ukiyyqf9.us-east-1.elasticbeanstalk.com',
  'http://light-engine-foxtrot-prod-v3.eba-ukiyyqf9.us-east-1.elasticbeanstalk.com',
  'https://light-engine-demo-1765326376.s3-website-us-east-1.amazonaws.com',
  'https://light-engine-foxtrot-prod.eba-ukiyyqf9.us-east-1.elasticbeanstalk.com',
  'https://light-engine-foxtrot-prod-v2.eba-ukiyyqf9.us-east-1.elasticbeanstalk.com',
  'https://light-engine-foxtrot-prod-v3.eba-ukiyyqf9.us-east-1.elasticbeanstalk.com',
  'http://greenreachgreens.com',
  'https://greenreachgreens.com',
  'http://www.greenreachgreens.com',
  'https://www.greenreachgreens.com',
  'http://urbanyeild.ca',
  'https://urbanyeild.ca',
  'http://www.urbanyeild.ca',
  'https://www.urbanyeild.ca',
  'http://localhost:8091',
  'http://127.0.0.1:8091',
];

// Allow any *.greenreachgreens.com or *.urbanyeild.ca subdomain (farm subdomains)
function isSubdomainAllowed(origin) {
  try {
    const url = new URL(origin);
    const host = url.hostname;
    return host.endsWith('.greenreachgreens.com') || host.endsWith('.urbanyeild.ca');
  } catch { return false; }
}

function isOriginAllowed(origin) {
  return ALLOWED_ORIGINS.includes(origin) || isSubdomainAllowed(origin);
}

export function setCorsHeaders(req, res, next) {
  const origin = req.headers.origin;
  const isProduction = process.env.NODE_ENV === 'production';
  
  console.log('[CORS] Request:', {
    origin,
    method: req.method,
    path: req.path,
    nodeEnv: process.env.NODE_ENV,
    isProduction
  });
  
  // Check if origin is in allowed list (includes *.greenreachgreens.com subdomains)
  if (origin && isOriginAllowed(origin)) {
    console.log('[CORS] ✓ Allowed origin:', origin);
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Max-Age', '600');
  } else if (!origin) {
    // Allow requests with no origin (same-origin, server-to-server, curl without -H Origin)
    console.log('[CORS] ✓ No origin header (same-origin or server-to-server)');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    res.setHeader('Access-Control-Max-Age', '600');
  } else if (!isProduction) {
    // Development: allow all origins
    console.log('[CORS] ✓ Development mode - allowing origin:', origin);
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    res.setHeader('Access-Control-Max-Age', '600');
  } else {
    // Production: reject unknown origins
    console.error('[CORS] ✗ REJECTED unauthorized origin in production:', origin);
    console.error('[CORS] Allowed origins:', ALLOWED_ORIGINS);
    return res.status(403).json({ 
      error: 'Forbidden', 
      message: 'Origin not allowed',
      origin: origin,
      environment: 'production'
    });
  }
  
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    console.log('[CORS] Handling OPTIONS preflight');
    return res.sendStatus(204);
  }
  
  next();
}