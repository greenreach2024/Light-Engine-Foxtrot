# Wholesale Product Request Feature

## Overview
The Product Request feature allows wholesale buyers to request products that aren't currently in the catalog. When a buyer submits a request, **all active farms** are notified via email.

## How It Works

### 1. Buyer Submits Request
From the wholesale portal (GR-wholesale.html), buyers can:
- Click "Request a Product" button
- Fill out the form with:
  - Product name (required)
  - Quantity and unit (required)
  - Needed by date (required)
  - Description (optional)
  - Maximum price per unit (optional)
  - Certifications required (e.g., Organic)

### 2. System Processes Request
When submitted:
1. Request is saved to `wholesale_product_requests` table
2. System queries all active farms from the `farms` table
3. Looks up admin user email for each farm (from `users` table where `role = 'admin'`)
4. Sends detailed email notification to each farm

### 3. Farm Notification Email
Each farm receives an email with:
- **Product details**: Name, quantity, unit, needed by date
- **Pricing**: Maximum price buyer is willing to pay (if specified)
- **Certifications**: Required certifications (e.g., Organic)
- **Buyer information**: Business name, contact name, email, type
- **Call to action**: Direct "Reply to Buyer" button with pre-filled email

### 4. Farm Responds Directly
Farms respond directly to the buyer via email with:
- Availability and quantity they can provide
- Their pricing per unit
- Earliest delivery date
- Relevant certifications

## Database Schema

```sql
CREATE TABLE wholesale_product_requests (
  id SERIAL PRIMARY KEY,
  buyer_id INTEGER NOT NULL REFERENCES wholesale_buyers(id),
  product_name VARCHAR(255) NOT NULL,
  quantity DECIMAL(10, 2) NOT NULL,
  unit VARCHAR(50) NOT NULL,
  needed_by_date DATE NOT NULL,
  description TEXT,
  max_price_per_unit DECIMAL(10, 2),
  certifications_required JSONB DEFAULT '[]',
  status VARCHAR(20) NOT NULL DEFAULT 'open',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
```

## API Endpoints

### POST /api/wholesale/product-requests/create
Creates a new product request and notifies all farms.

**Authentication**: Requires Bearer token (wholesale buyer JWT)

**Request Body**:
```json
{
  "buyer_id": 1,
  "product_name": "Cherry Tomatoes",
  "quantity": 50,
  "unit": "lbs",
  "needed_by_date": "2026-02-15",
  "description": "Prefer heirloom varieties",
  "max_price_per_unit": 4.50,
  "certifications_required": ["Organic"]
}
```

**Response**:
```json
{
  "ok": true,
  "request_id": 42,
  "matched_farms": 4,
  "message": "Request submitted! 4 farms have been notified."
}
```

### GET /api/wholesale/product-requests/buyer/:buyerId
Gets all product requests for a specific buyer.

**Authentication**: Requires Bearer token

**Response**:
```json
{
  "ok": true,
  "requests": [
    {
      "id": 42,
      "product_name": "Cherry Tomatoes",
      "quantity": 50,
      "unit": "lbs",
      "needed_by_date": "2026-02-15",
      "description": "Prefer heirloom varieties",
      "max_price_per_unit": 4.50,
      "certifications_required": ["Organic"],
      "status": "open",
      "created_at": "2026-01-19T12:00:00Z"
    }
  ]
}
```

## Which Farms Are Notified?

**All active farms** in the network are notified, based on this query:
```sql
SELECT f.farm_id, f.name, u.email, f.address
FROM farms f
LEFT JOIN users u ON u.farm_id = f.farm_id 
  AND u.role = 'admin' 
  AND u.is_active = true
WHERE f.is_active = true
ORDER BY f.name
```

This includes:
- Any farm with `is_active = true` in the `farms` table
- That has at least one admin user with an email address
- Regardless of geographic location (future: could add location filtering)

## Current Active Farms

Based on your log showing "4 active farms":
1. Big Green Farm
2. jjjjjj
3. Peter's Farm
4. Peter's Farm (duplicate entry?)

These farms will receive email notifications when a product request is submitted.

## Email Requirements

The system uses the email service configured in `/lib/email-service.js`:
- Sends via AWS SES (configured in environment variables)
- Falls back to Nodemailer SMTP if SES is not configured
- Requires farms to have admin users with valid email addresses

## Future Enhancements

Potential improvements:
1. **Geographic filtering**: Only notify farms within X miles of buyer
2. **Category matching**: Only notify farms that grow similar products
3. **Response tracking**: Allow farms to respond through portal (not just email)
4. **Buyer dashboard**: Show which farms viewed/responded to requests
5. **Auto-matching**: Suggest farms based on past orders and inventory
6. **SMS notifications**: Add SMS alerts for farms (in addition to email)

## Troubleshooting

### No farms are notified
- Check that farms exist in `farms` table with `is_active = true`
- Verify farms have admin users in `users` table
- Confirm admin users have valid email addresses
- Check email service logs for sending failures

### Emails not being received
- Verify AWS SES is configured and production access is enabled
- Check sender email is verified in AWS SES
- Check recipient emails are not bouncing
- Look for errors in server logs: `[Product Request]` prefix

### 500 errors when submitting
- Verify database table exists (run migration)
- Check buyer_id exists in wholesale_buyers table
- Ensure all required fields are provided
- Check server logs for detailed error messages

## Files Modified

1. **routes/wholesale-product-requests.js** - New route handler
2. **server-foxtrot.js** - Mounted new router
3. **migrations/20260119_create_wholesale_product_requests.sql** - Database schema
4. **public/js/wholesale.js** - Already has frontend implementation

## Testing

To test the feature:
1. Sign in as a wholesale buyer at greenreachgreens.com/GR-wholesale.html
2. Click "Request a Product" button
3. Fill out the form with test data
4. Submit the request
5. Check email inboxes for all farm admin users
6. Verify each farm received the notification with correct details
