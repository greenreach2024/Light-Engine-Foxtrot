/**
 * Light Engine: Input Validation & Sanitization
 * Express-validator middleware for API endpoint protection
 * 
 * Security Features:
 * - SQL injection prevention
 * - XSS attack prevention
 * - Input type validation
 * - Input sanitization
 * - Request payload size limits
 * 
 * Usage:
 *   import { validateReservation, handleValidationErrors } from './lib/input-validation.js';
 *   router.post('/reserve', validateReservation, handleValidationErrors, handler);
 */

import { body, param, query, validationResult } from 'express-validator';

/**
 * Middleware: Handle validation errors
 * Returns 400 with detailed error messages if validation fails
 */
export const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  
  if (!errors.isEmpty()) {
    return res.status(400).json({
      ok: false,
      error: 'validation_error',
      message: 'Invalid request parameters',
      details: errors.array().map(err => ({
        field: err.path,
        message: err.msg,
        value: err.value
      }))
    });
  }
  
  next();
};

/**
 * Common validation rules
 */

// Order ID: alphanumeric with hyphens, max 100 chars
export const orderIdValidation = () => 
  body('order_id')
    .trim()
    .notEmpty().withMessage('order_id is required')
    .isLength({ max: 100 }).withMessage('order_id must be 100 characters or less')
    .matches(/^[a-zA-Z0-9-_]+$/).withMessage('order_id must be alphanumeric with hyphens/underscores only')
    .escape();

// SKU ID: alphanumeric with hyphens, max 100 chars
export const skuIdValidation = (fieldName = 'sku_id') =>
  body(fieldName)
    .trim()
    .notEmpty().withMessage(`${fieldName} is required`)
    .isLength({ max: 100 }).withMessage(`${fieldName} must be 100 characters or less`)
    .matches(/^[a-zA-Z0-9-_]+$/).withMessage(`${fieldName} must be alphanumeric with hyphens/underscores only`)
    .escape();

// Quantity: positive integer, max 10000
export const quantityValidation = (fieldName = 'quantity') =>
  body(fieldName)
    .isInt({ min: 1, max: 10000 }).withMessage(`${fieldName} must be between 1 and 10000`)
    .toInt();

// Email validation
export const emailValidation = (fieldName = 'email') =>
  body(fieldName)
    .trim()
    .isEmail().withMessage(`${fieldName} must be a valid email address`)
    .normalizeEmail()
    .isLength({ max: 255 }).withMessage(`${fieldName} must be 255 characters or less`);

// Farm ID validation
export const farmIdValidation = (fieldName = 'farm_id') =>
  body(fieldName)
    .trim()
    .notEmpty().withMessage(`${fieldName} is required`)
    .matches(/^[a-zA-Z0-9-_]+$/).withMessage(`${fieldName} must be alphanumeric with hyphens/underscores`)
    .isLength({ max: 50 }).withMessage(`${fieldName} must be 50 characters or less`)
    .escape();

// Text field validation (general purpose)
export const textFieldValidation = (fieldName, maxLength = 500) =>
  body(fieldName)
    .optional()
    .trim()
    .isLength({ max: maxLength }).withMessage(`${fieldName} must be ${maxLength} characters or less`)
    .escape();

// URL validation
export const urlValidation = (fieldName = 'url') =>
  body(fieldName)
    .optional()
    .trim()
    .isURL({ protocols: ['http', 'https'], require_protocol: true })
    .withMessage(`${fieldName} must be a valid HTTP/HTTPS URL`)
    .isLength({ max: 2048 }).withMessage(`${fieldName} must be 2048 characters or less`);

/**
 * Wholesale Endpoint Validations
 */

// POST /api/wholesale/inventory/reserve
export const validateReservation = [
  orderIdValidation(),
  body('items')
    .isArray({ min: 1, max: 100 }).withMessage('items must be an array with 1-100 elements'),
  body('items.*.sku_id')
    .trim()
    .notEmpty().withMessage('Each item must have a sku_id')
    .matches(/^[a-zA-Z0-9-_]+$/).withMessage('sku_id must be alphanumeric with hyphens/underscores')
    .isLength({ max: 100 }).withMessage('sku_id must be 100 characters or less')
    .escape(),
  body('items.*.quantity')
    .isInt({ min: 1, max: 10000 }).withMessage('quantity must be between 1 and 10000')
    .toInt(),
  body('ttl_minutes')
    .optional()
    .isInt({ min: 1, max: 1440 }).withMessage('ttl_minutes must be between 1 and 1440 (24 hours)')
    .toInt()
];

// POST /api/wholesale/inventory/confirm
export const validateConfirmation = [
  orderIdValidation(),
  body('payment_id')
    .optional()
    .trim()
    .isLength({ max: 255 }).withMessage('payment_id must be 255 characters or less')
    .escape()
];

// POST /api/wholesale/inventory/release
export const validateRelease = [
  orderIdValidation(),
  textFieldValidation('reason', 500)
];

// POST /api/wholesale/inventory/rollback
export const validateRollback = [
  orderIdValidation(),
  body('reason')
    .trim()
    .notEmpty().withMessage('reason is required for rollback')
    .isLength({ max: 500 }).withMessage('reason must be 500 characters or less')
    .escape()
];

// POST /api/wholesale/order-events
export const validateOrderEvent = [
  orderIdValidation(),
  body('event_type')
    .optional()
    .trim()
    .isIn(['status_change', 'tracking_update', 'note_added', 'issue_reported', 'wholesale_order_created'])
    .withMessage('event_type must be one of: status_change, tracking_update, note_added, issue_reported, wholesale_order_created'),
  body('type')
    .optional()
    .trim()
    .isIn(['status_change', 'tracking_update', 'note_added', 'issue_reported', 'wholesale_order_created', 'unknown'])
    .withMessage('type must be a valid event type'),
  body('status')
    .optional()
    .trim()
    .isIn(['pending', 'confirmed', 'packed', 'shipped', 'delivered', 'cancelled'])
    .withMessage('status must be valid order status'),
  body('tracking_number')
    .optional()
    .trim()
    .matches(/^[a-zA-Z0-9-]+$/).withMessage('tracking_number must be alphanumeric with hyphens')
    .isLength({ max: 100 }).withMessage('tracking_number must be 100 characters or less')
    .escape(),
  textFieldValidation('note', 1000)
];

// POST /api/wholesale/admin/keys
export const validateApiKeyGeneration = [
  farmIdValidation('farm_id'),
  body('farm_name')
    .trim()
    .notEmpty().withMessage('farm_name is required')
    .isLength({ max: 255 }).withMessage('farm_name must be 255 characters or less')
    .escape()
];

// Farm ID param validation
export const validateFarmIdParam = [
  param('farm_id')
    .trim()
    .notEmpty().withMessage('farm_id is required')
    .matches(/^[a-zA-Z0-9-_]+$/).withMessage('farm_id must be alphanumeric with hyphens/underscores')
    .isLength({ max: 50 }).withMessage('farm_id must be 50 characters or less')
    .escape()
];

/**
 * Farm Registration Validation
 */
export const validateFarmRegistration = [
  body('name')
    .trim()
    .notEmpty().withMessage('name is required')
    .isLength({ min: 2, max: 255 }).withMessage('name must be 2-255 characters')
    .escape(),
  emailValidation('email'),
  body('phone')
    .optional()
    .trim()
    .matches(/^\+?[1-9]\d{1,14}$/).withMessage('phone must be valid E.164 format')
    .escape(),
  body('address_line1')
    .optional()
    .trim()
    .isLength({ max: 500 }).withMessage('address_line1 must be 500 characters or less')
    .escape(),
  body('city')
    .optional()
    .trim()
    .isLength({ max: 100 }).withMessage('city must be 100 characters or less')
    .escape(),
  body('state')
    .optional()
    .trim()
    .isLength({ max: 50 }).withMessage('state must be 50 characters or less')
    .escape(),
  body('postal_code')
    .optional()
    .trim()
    .isLength({ max: 20 }).withMessage('postal_code must be 20 characters or less')
    .escape(),
  body('latitude')
    .optional()
    .isFloat({ min: -90, max: 90 }).withMessage('latitude must be between -90 and 90')
    .toFloat(),
  body('longitude')
    .optional()
    .isFloat({ min: -180, max: 180 }).withMessage('longitude must be between -180 and 180')
    .toFloat()
];

/**
 * Product/Inventory Validation
 */
export const validateProductSync = [
  body('products')
    .isArray({ min: 0, max: 1000 }).withMessage('products must be an array with 0-1000 elements'),
  body('products.*.sku_id')
    .trim()
    .notEmpty().withMessage('sku_id is required')
    .matches(/^[a-zA-Z0-9-_]+$/).withMessage('sku_id must be alphanumeric')
    .isLength({ max: 100 }).withMessage('sku_id must be 100 characters or less')
    .escape(),
  body('products.*.name')
    .trim()
    .notEmpty().withMessage('product name is required')
    .isLength({ max: 255 }).withMessage('name must be 255 characters or less')
    .escape(),
  body('products.*.quantity_available')
    .isInt({ min: 0, max: 1000000 }).withMessage('quantity_available must be 0-1000000')
    .toInt(),
  body('products.*.price_per_unit')
    .isFloat({ min: 0, max: 100000 }).withMessage('price_per_unit must be 0-100000')
    .toFloat()
];

/**
 * Query parameter validation
 */
export const validatePaginationParams = [
  query('page')
    .optional()
    .isInt({ min: 1, max: 10000 }).withMessage('page must be between 1 and 10000')
    .toInt(),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 }).withMessage('limit must be between 1 and 100')
    .toInt()
];

export const validateDateRangeParams = [
  query('start_date')
    .optional()
    .isISO8601().withMessage('start_date must be ISO 8601 format')
    .toDate(),
  query('end_date')
    .optional()
    .isISO8601().withMessage('end_date must be ISO 8601 format')
    .toDate()
];

/**
 * Sanitization utilities
 */

// Remove HTML tags from user input
export const stripHtmlTags = (str) => {
  if (!str) return str;
  return str.replace(/<[^>]*>/g, '');
};

// Sanitize object recursively (for JSON payloads)
export const sanitizeObject = (obj, maxDepth = 5, currentDepth = 0) => {
  if (currentDepth >= maxDepth) return obj;
  
  if (typeof obj === 'string') {
    return stripHtmlTags(obj);
  }
  
  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeObject(item, maxDepth, currentDepth + 1));
  }
  
  if (obj && typeof obj === 'object') {
    const sanitized = {};
    for (const [key, value] of Object.entries(obj)) {
      sanitized[key] = sanitizeObject(value, maxDepth, currentDepth + 1);
    }
    return sanitized;
  }
  
  return obj;
};

/**
 * Middleware: Sanitize request body
 * Apply after express.json() to sanitize all parsed JSON
 */
export const sanitizeRequestBody = (req, res, next) => {
  if (req.body && typeof req.body === 'object') {
    req.body = sanitizeObject(req.body);
  }
  next();
};

export default {
  handleValidationErrors,
  validateReservation,
  validateConfirmation,
  validateRelease,
  validateRollback,
  validateOrderEvent,
  validateApiKeyGeneration,
  validateFarmIdParam,
  validateFarmRegistration,
  validateProductSync,
  validatePaginationParams,
  validateDateRangeParams,
  sanitizeRequestBody,
  sanitizeObject,
  stripHtmlTags
};
