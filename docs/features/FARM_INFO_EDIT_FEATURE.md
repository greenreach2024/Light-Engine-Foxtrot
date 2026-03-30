# Farm Info Editing with Edge Device Sync

## Overview
GreenReach Central now supports editing farm contact information directly from the Farm Summary page, with automatic synchronization to the edge device's `farm.json` file.

## Features

### Frontend (GreenReach Central Admin)
- **Edit Info Button**: Click to enable inline editing mode
- **Editable Fields**:
  - Farm Owner
  - Key Contact Name
  - Phone Number
  - Email Address
  - Website URL
  - Physical Address
- **Save & Sync Button**: Saves changes to GreenReach Central database and pushes updates to edge device
- **Cancel Button**: Discards changes and returns to view mode
- **Success Notification**: Visual feedback when save is successful

### Backend Architecture

#### GreenReach Central API
**Endpoint**: `PATCH /api/admin/farms/:farmId/metadata`

**Access Control**: Requires `admin` or `operations` role (RBAC)

**Request Body**:
```json
{
  "contact": {
    "owner": "John Doe",
    "contactName": "Jane Smith",
    "phone": "555-0123",
    "email": "contact@farm.com",
    "website": "https://farm.com",
    "address": "123 Farm Road, City, ST 12345"
  }
}
```

**Response**:
```json
{
  "success": true,
  "message": "Farm metadata updated successfully",
  "syncStatus": "synced",
  "metadata": { /* updated metadata */ }
}
```

**Sync Status Values**:
- `synced`: Successfully pushed to edge device
- `sync_failed`: Edge device returned error
- `sync_error`: Network/connection error
- `no_api_url`: No edge device URL available
- `not_attempted`: Sync was not tried

#### Edge Device API
**Endpoint**: `PATCH /api/config/farm-metadata`

**Authentication**: Requires `X-API-Key` header

**Request Body**:
```json
{
  "contact": {
    "owner": "John Doe",
    "name": "Jane Smith",
    "phone": "555-0123",
    "email": "contact@farm.com",
    "website": "https://farm.com",
    "address": "123 Farm Road, City, ST 12345"
  }
}
```

**Response**:
```json
{
  "success": true,
  "message": "Farm metadata updated successfully",
  "metadata": { /* updated farm.json metadata */ }
}
```

**File Updated**: `/farm.json`

The endpoint updates the `metadata.contact` object in farm.json and adds tracking fields:
- `metadata.lastUpdated`: ISO timestamp
- `metadata.updatedBy`: "GreenReach Central"

## Data Flow

### 1. Initial Load (Edge → Central → UI)
```
Edge Device farm.json
  → Heartbeat/Sync → GreenReach Central DB (farms.metadata)
  → API Response → Frontend Display
```

### 2. Edit & Save (UI → Central → Edge)
```
User Edit Form
  → PATCH /api/admin/farms/:farmId/metadata
  → Update Central DB (farms.metadata)
  → Push to Edge: PATCH /api/config/farm-metadata
  → Update Edge farm.json
  → Return Success to UI
```

### 3. Next Sync (Edge → Central)
```
Edge Device (updated farm.json)
  → Next Heartbeat → GreenReach Central
  → Confirms changes persisted
```

## Security

### GreenReach Central
- **Role-Based Access Control (RBAC)**: Only `admin` and `operations` roles can edit farm metadata
- **JWT Authentication**: Admin users must be logged in
- **Input Validation**: Contact fields validated before saving

### Edge Device
- **API Key Authentication**: `X-API-Key` header required
- **File System Security**: farm.json written with proper permissions
- **Error Handling**: Graceful fallback if farm.json doesn't exist

## User Experience

### Edit Mode Flow
1. Click **"Edit Info"** button in Farm Summary card
2. Display values hide, input fields appear with current values
3. Edit any fields (leave blank to keep existing)
4. Click **"Save & Sync"** to commit changes
5. GreenReach Central updates database
6. Changes pushed to edge device automatically
7. Success notification appears
8. Form returns to view mode with updated values

### Cancel Flow
1. Click **"Cancel"** button while in edit mode
2. Input fields hide, original display values return
3. No changes saved or synced

## Database Schema

### farms.metadata (PostgreSQL JSONB)
```sql
{
  "contact": {
    "owner": "string",
    "name": "string",
    "contactName": "string",
    "phone": "string",
    "email": "string",
    "website": "string",
    "address": "string"
  },
  "url": "string",
  "location": {
    "street": "string",
    "city": "string",
    "state": "string",
    "zip": "string"
  }
}
```

## Edge Device farm.json Structure
```json
{
  "farmId": "FARM-ABC123-XYZ",
  "farmName": "Big Green Farm",
  "metadata": {
    "contact": {
      "owner": "John Doe",
      "name": "Jane Smith",
      "contactName": "Jane Smith",
      "phone": "555-0123",
      "email": "contact@farm.com",
      "website": "https://farm.com",
      "address": "123 Farm Road, City, ST 12345"
    },
    "lastUpdated": "2026-01-31T15:00:00.000Z",
    "updatedBy": "GreenReach Central"
  }
}
```

## Error Handling

### Frontend
- Alerts user if save fails
- Logs errors to console
- Returns to view mode on cancel

### GreenReach Central
- Validates farm exists before update
- Returns 404 if farm not found
- Returns 400 if contact object invalid
- Attempts edge sync but doesn't fail if sync fails
- Returns sync status in response

### Edge Device
- Creates farm.json if it doesn't exist
- Merges new contact data with existing metadata
- Returns 500 if file write fails
- Logs all operations

## Testing

### Manual Test (Local)
1. Start GreenReach Central: `cd greenreach-central && npm start`
2. Start Edge Device: `PORT=8091 node server-foxtrot.js`
3. Login to GreenReach Central Admin
4. Navigate to farm detail page
5. Click "Edit Info" in Farm Summary
6. Update contact fields
7. Click "Save & Sync"
8. Verify success notification
9. Check edge device `farm.json` file was updated
10. Check edge device logs for PATCH request

### Production Verification
1. Login to https://greenreachgreens.com/central-admin.html
2. Select Big Green Farm
3. Click "Edit Info"
4. Update owner to "Big Green Farm LLC"
5. Click "Save & Sync"
6. SSH to edge device: `ssh greenreach@100.65.187.59`
7. Check farm.json: `cat farm.json | jq '.metadata.contact'`
8. Verify owner field updated

## Future Enhancements
- **Bulk Edit**: Update multiple farms at once
- **Change History**: Track who changed what and when
- **Validation Rules**: Phone format, email format, URL validation
- **Conflict Resolution**: Handle simultaneous edits
- **Offline Support**: Queue updates when edge device offline
- **Rollback**: Undo recent changes
- **Approval Workflow**: Require approval for critical changes

## Related Files
- **Frontend UI**: `greenreach-central/public/GR-central-admin.html`
- **Frontend JS**: `greenreach-central/public/central-admin.js`
- **Central API**: `greenreach-central/routes/admin.js`
- **Edge API**: `server-foxtrot.js`
- **Edge Data**: `farm.json`

## Deployment Status
✅ Deployed to production: 2026-01-31
✅ GreenReach Central: https://greenreachgreens.com
✅ Edge Device: Running on Big Green Farm
