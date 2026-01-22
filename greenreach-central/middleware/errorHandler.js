/**
 * Error Handler Middleware
 */

// Custom error classes
export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
    this.statusCode = 400;
  }
}

export class NotFoundError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NotFoundError';
    this.statusCode = 404;
  }
}

export class UnauthorizedError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UnauthorizedError';
    this.statusCode = 401;
  }
}

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

