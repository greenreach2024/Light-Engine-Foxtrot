/**
 * Error Handler Middleware
 */

export function errorHandler(err, req, res, next) {
  console.error('Error occurred:', err);
  
  const statusCode = err.statusCode || err.status || 500;
  const message = err.message || 'Something went wrong';
  
  res.status(statusCode).json({
    error: statusCode === 500 ? 'Internal Server Error' : message,
    message: statusCode === 500 ? message : undefined,
    requestId: Date.now().toString(),
    timestamp: new Date().toISOString()
  });
}
