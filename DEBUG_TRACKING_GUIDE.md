# Debug Tracking System - GreenReach Central

## Overview
Comprehensive debug tracking system deployed to GreenReach Central admin dashboard to track all user interactions, page views, API calls, and errors.

## Deployment
- **Deployed:** January 27, 2026
- **Version:** app-260127_171537947566
- **Commit:** 1455277
- **Environment:** greenreach-central-prod-lb

## What's Being Tracked

### 1. **Page Views**
Every time you navigate to a different view, it logs:
- View name (e.g., `farm-detail-view`, `operations-overview`, `alerts-view`)
- Previous view
- Timestamp

### 2. **API Calls**
Every API request logs:
- HTTP method (GET/POST/PUT/DELETE)
- Full URL
- Response status code
- Response time in milliseconds
- Error message (if failed)

### 3. **User Clicks**
All clicks on interactive elements:
- Buttons
- Links
- Navigation menu items
- Farm cards
- Element ID, class, and text content

### 4. **Errors**
All JavaScript errors and failures:
- Global JavaScript errors
- Unhandled promise rejections
- API call failures
- View loading failures
- Error stack traces

### 5. **Navigation**
View transitions:
- From which view
- To which view
- Context data

## How to Use - Developer Console

### Open Browser Console
1. Right-click on the page → **Inspect**
2. Click the **Console** tab
3. You'll see orange `[DEBUG TRACK]` logs for all events

### View Recent Events
```javascript
// Get last 20 events
window.DEBUG.getEvents(20)

// Get all page views in session
window.DEBUG.showPageViews()

// Get last error
window.DEBUG.showLastError()

// Get last API call
window.DEBUG.showLastAPICall()

// Export full session data (all events)
window.DEBUG.exportSession()
```

### Filter Console Logs
In the console filter box, type:
- `DEBUG TRACK` - See only debug tracking events
- `PAGE_VIEW` - See only page navigation
- `API_CALL` - See only API requests
- `ERROR` - See only errors
- `CLICK` - See only click events

## Example Output

### Page View
```javascript
[DEBUG TRACK] PAGE_VIEW
{
  type: "PAGE_VIEW",
  view: "farm-detail-view",
  context: { previousView: "operations-overview" },
  timestamp: "2026-01-27T22:15:00.000Z",
  sessionId: "1738012345-abc123"
}
```

### API Call
```javascript
[DEBUG TRACK] API_CALL
{
  type: "API_CALL",
  method: "GET",
  url: "https://greenreachgreens.com/api/admin/farms/FARM-MKLOMAT3-A9D8",
  status: 200,
  responseTime: "234ms",
  error: null
}
```

### Error
```javascript
[DEBUG TRACK] ERROR
{
  type: "ERROR",
  errorType: "FARM_DETAIL_LOAD_FAILED",
  message: "Failed to load farm FARM-MKLOMAT3-A9D8",
  context: { status: 404, errorText: "Not found" },
  stack: "Error: ..."
}
```

## Troubleshooting Workflow

### Problem: Page Not Loading Data
1. Open Console (F12)
2. Navigate to the page
3. Look for:
   - `PAGE_VIEW` event - Did the view change?
   - `API_CALL` events - Which APIs were called?
   - `ERROR` events - Did anything fail?
4. Check API response:
   ```javascript
   window.DEBUG.showLastAPICall()
   ```

### Problem: Navigation Not Working
1. Click the navigation item
2. Look for:
   - `CLICK` event with navigation details
   - `PAGE_VIEW` event showing view change
3. Check if view exists:
   ```javascript
   // Last error will show "VIEW_NOT_FOUND" if view element is missing
   window.DEBUG.showLastError()
   ```

### Problem: Unknown Error
1. Check last error:
   ```javascript
   window.DEBUG.showLastError()
   ```
2. Export full session for analysis:
   ```javascript
   copy(JSON.stringify(window.DEBUG.exportSession(), null, 2))
   ```
   Then paste into a text file or send to developer

## Session Tracking

Each browser session gets a unique ID:
- Format: `timestamp-randomstring` (e.g., `1738012345-abc123`)
- Preserved across page navigation
- Reset on browser refresh
- Visible in all debug events

## Data Retention

- **In-memory:** Last 100 events
- **Console:** All events (visible in browser console)
- **Persistent:** None (not sent to server)

To preserve data across refresh:
```javascript
// Before refreshing, export session
const session = window.DEBUG.exportSession();
localStorage.setItem('debug_session', JSON.stringify(session));

// After refresh, retrieve
const oldSession = JSON.parse(localStorage.getItem('debug_session'));
```

## Performance Impact

Minimal:
- Event logging: ~1ms per event
- Memory: ~100 events × ~500 bytes = ~50KB
- No network calls
- No blocking operations

## Disable Tracking

To disable temporarily (in console):
```javascript
DEBUG_TRACKING.enabled = false
```

To re-enable:
```javascript
DEBUG_TRACKING.enabled = true
```

## Next Steps

When you see issues:
1. **Open Console** (F12 → Console tab)
2. **Reproduce the issue** (click, navigate, etc.)
3. **Look for orange `[DEBUG TRACK]` logs**
4. **Check for errors:** `window.DEBUG.showLastError()`
5. **Share the output** with developer if needed

## Contact

For questions or issues with debug tracking:
- Check browser console first
- Export session data: `window.DEBUG.exportSession()`
- Share console output with development team
