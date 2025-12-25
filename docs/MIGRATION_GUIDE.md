# Cloud-to-Edge Migration System

Complete migration system for moving from cloud-only deployment to edge deployment with full hardware support.

## Features

- **Export API**: Export complete farm data from cloud deployment
- **Import API**: Import data into edge device with validation
- **Migration Wizard**: Step-by-step UI for guided migration
- **Rollback System**: Create automatic backups and rollback if needed
- **Data Validation**: Verify data integrity with checksums
- **Progress Tracking**: Real-time progress updates during migration

## Quick Start

### 1. Export Data from Cloud

```bash
# From cloud deployment
curl -X POST https://your-farm.greenreach.io/api/migration/export \
  -H "Authorization: Bearer $CLOUD_TOKEN" \
  > farm-export.json
```

### 2. Validate Export

```bash
# On edge device
curl -X POST http://localhost:3000/api/migration/validate \
  -H "Content-Type: application/json" \
  -d @farm-export.json
```

### 3. Import to Edge

```bash
# On edge device
curl -X POST http://localhost:3000/api/migration/import \
  -H "Content-Type: application/json" \
  -d @farm-export.json
```

## Web Wizard

For a guided experience, use the migration wizard:

1. Navigate to `http://localhost:3000/migration-wizard.html`
2. Follow the 4-step wizard:
   - **Step 1**: Export data from cloud
   - **Step 2**: Upload and validate export file
   - **Step 3**: Review and import data
   - **Step 4**: Complete and get rollback ID

## API Reference

### Export Data

**POST** `/api/migration/export`

Exports complete farm data including:
- Farm configuration and settings
- Users and permissions
- Inventory and products
- Orders (last 12 months)
- Wholesale relationships
- Automation recipes and zones
- Sensor data (last 90 days)
- Certifications

**Response:**
```json
{
  "success": true,
  "exportId": "abc123...",
  "checksum": "sha256hash...",
  "stats": {
    "userCount": 5,
    "productCount": 42,
    "inventoryCount": 120,
    "orderCount": 87
  },
  "data": { /* complete export package */ }
}
```

### Validate Export

**POST** `/api/migration/validate`

Validates export data before import.

**Request:**
```json
{
  "exportId": "abc123",
  "checksum": "sha256hash",
  "version": "1.0",
  /* ... export data ... */
}
```

**Response:**
```json
{
  "valid": true,
  "errors": [],
  "warnings": [
    "Large sensor dataset: 85000 records. Import may take several minutes."
  ],
  "stats": { /* data counts */ },
  "estimatedSize": "45.23 MB"
}
```

### Import Data

**POST** `/api/migration/import`

Imports validated export data to edge device.

**Important:**
- Creates automatic backup for rollback
- All imports are transactional
- Rollback ID is returned for undo capability

**Response:**
```json
{
  "success": true,
  "message": "Migration completed successfully",
  "rollbackId": "def456...",
  "stats": {
    "usersImported": 5,
    "productsImported": 42,
    "inventoryImported": 120,
    "ordersImported": 87
  }
}
```

### Rollback Migration

**POST** `/api/migration/rollback/:rollbackId`

Rolls back migration to pre-import state.

**Response:**
```json
{
  "success": true,
  "message": "Rollback completed successfully",
  "rollbackId": "def456..."
}
```

### Get Migration Status

**GET** `/api/migration/status`

Get migration history and available rollback points.

**Response:**
```json
{
  "migrations": [
    {
      "id": 1,
      "export_id": "abc123",
      "rollback_id": "def456",
      "farm_id": 1,
      "imported_at": "2025-12-24T10:00:00Z",
      "status": "completed"
    }
  ],
  "exports": [ /* export history */ ],
  "hasRollbackPoints": true
}
```

## Data Export Structure

```json
{
  "exportId": "unique-export-id",
  "exportDate": "2025-12-24T10:00:00Z",
  "version": "1.0",
  "sourceType": "cloud",
  "checksum": "sha256-checksum",
  "farm": {
    "id": 1,
    "name": "Green Valley Farm",
    "location": "Boulder, CO",
    "timezone": "America/Denver"
  },
  "users": [
    {
      "id": 1,
      "username": "admin",
      "email": "admin@greenvalley.com",
      "role": "admin"
    }
  ],
  "inventory": [ /* inventory items */ ],
  "products": [ /* product definitions */ ],
  "orders": [ /* order history */ ],
  "wholesale": {
    "buyers": [ /* wholesale buyers */ ],
    "products": [ /* wholesale products */ ]
  },
  "automation": {
    "recipes": [ /* automation recipes */ ],
    "zones": [ /* grow zones */ ]
  },
  "sensorData": [ /* sensor readings */ ],
  "settings": [ /* farm settings */ ],
  "certifications": [ /* certifications */ ],
  "stats": {
    "userCount": 5,
    "inventoryCount": 120,
    "productCount": 42,
    "orderCount": 87,
    "sensorDataPoints": 85000
  }
}
```

## Rollback Process

1. **Automatic Backup**: Before import, complete backup of all tables
2. **Rollback ID**: Unique ID for identifying backup
3. **30-Day Retention**: Rollback points kept for 30 days
4. **Transactional**: Rollback is atomic - all or nothing

**Execute Rollback:**

```bash
curl -X POST http://localhost:3000/api/migration/rollback/def456 \
  -H "Authorization: Bearer $TOKEN"
```

## Security Considerations

1. **Export File Security**:
   - Contains sensitive farm data
   - Store securely and encrypt at rest
   - Delete after successful migration

2. **Authentication**:
   - Export requires valid cloud authentication
   - Import requires edge device authentication
   - User passwords are NOT exported

3. **Validation**:
   - SHA-256 checksum verification
   - Version compatibility check
   - Data structure validation

4. **Backups**:
   - Automatic pre-migration backups
   - Encrypted rollback storage
   - 30-day retention policy

## Troubleshooting

### Export Fails

**Check:**
- Cloud API is accessible
- Valid authentication token
- Sufficient disk space for export

**Solution:**
```bash
# Check API access
curl https://your-farm.greenreach.io/api/health

# Verify token
curl https://your-farm.greenreach.io/api/auth/verify \
  -H "Authorization: Bearer $TOKEN"
```

### Validation Errors

**Common Issues:**
- Checksum mismatch (corrupted file)
- Incompatible version
- Invalid data structure

**Solution:**
- Re-download export file
- Verify file integrity
- Check export format version

### Import Fails

**Causes:**
- Insufficient storage space
- Database connection issues
- Incompatible data format

**Solution:**
```bash
# Check disk space
df -h

# Check database
curl http://localhost:3000/api/health

# Review import logs
curl http://localhost:3000/api/migration/status
```

### Rollback Issues

**If rollback fails:**
1. Check rollback ID is valid
2. Verify backup data exists
3. Check database permissions
4. Contact support with rollback ID

## Performance

**Export Time:**
- Small farm (< 100 products): 1-2 seconds
- Medium farm (< 1000 products): 5-10 seconds
- Large farm (> 1000 products): 30-60 seconds

**Import Time:**
- Small farm: 10-20 seconds
- Medium farm: 30-60 seconds
- Large farm: 2-5 minutes

**Factors:**
- Number of orders
- Sensor data volume (90 days included)
- Network speed (if downloading export)

## Best Practices

1. **Test Migration**:
   - Test on staging environment first
   - Verify all data imported correctly
   - Test rollback before production

2. **Timing**:
   - Migrate during low-activity period
   - Notify users of downtime
   - Plan 30-minute maintenance window

3. **Validation**:
   - Always validate before import
   - Review warnings carefully
   - Check storage requirements

4. **Backup**:
   - Keep original export file
   - Note rollback ID
   - Test rollback within 24 hours

5. **Post-Migration**:
   - Verify all data present
   - Test wholesale orders
   - Configure hardware devices
   - Have users reset passwords

## Support

- **Migration Issues**: support@greenreach.io
- **Documentation**: https://docs.greenreach.io/migration
- **Community Forum**: https://community.greenreach.io

## Next Steps

After successful migration:

1. Configure hardware devices (sensors, controllers)
2. Set up automation recipes
3. Test wholesale marketplace
4. Configure local network access (mDNS)
5. Set up HTTPS with certificates
6. Train users on new system

See also:
- [Edge Deployment Guide](EDGE_DEPLOYMENT_GUIDE.md)
- [Hardware Setup](HARDWARE_SETUP.md)
- [Automation Recipes](AUTOMATION_RECIPES.md)
