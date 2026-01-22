/**
 * Error Handler Middleware
 */

export function errorHandler(err, req, res, next) {
  console.error('Error occurred:', err);
  console.error('Stack:', err.stack);
  console.error('Request:', req.method, req.path);
  
  const statusCode = err.statusCode || err.status || 500;
  const message = err.message || 'Something went wrong';
  
  res.status(statusCode).json({
    error: statusCode === 500 ? 'Internal Server Error' : message,
    message: message,
    stack: process.env.NODE_ENV === 'production' ? undefined : err.stack,
    requestId: Date.now().toString(),
    timestamp: new Date().toISOString()
  });
}
