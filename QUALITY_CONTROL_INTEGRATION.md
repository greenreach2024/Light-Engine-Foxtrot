# Quality Control Integration - Farm Activity Hub

## Overview

The Farm Activity Hub now includes **AI-powered photo quality control** integrated directly into daily/weekly checklists. This eliminates the need for separate inspection rounds - QA happens naturally as part of existing farm operations.

## How It Works

### For Growers

1. **Open Farm Activity Hub** (`/views/tray-inventory.html`)
2. **Open a checklist** (Daily/Weekly/Monthly/Quarterly)
3. **Find checklist items with "+ Photo QA" button:**
   - Check germination rate
   - Inspect all trays for pests or disease
   - Check plants for growth progress
   - Check seedling health and uniformity
   - Check harvest ready trays (includes weight entry)

4. **Tap "+ Photo QA" button**
5. **Take a photo** with your iPad/phone camera
6. **Scan the tray QR code** to link the photo
7. **Enter weight** (optional, only for specific items)
8. **AI analyzes automatically** and shows results
9. **Checklist item marks complete**

### No Extra Steps Required

QA checkpoints are created automatically as growers complete their normal daily tasks. Photo documentation and AI analysis happen in the background without adding burden to the workflow.

## AI Analysis Features

The system uses OpenAI Vision API (GPT-4 Vision) to analyze plant photos for:

- **Health Score** (0-100) with pass/fail thresholds
- **Color Quality** - vibrant, yellowing, browning
- **Size & Growth** - appropriate for stage, uniform
- **Disease Signs** - mold, rot, spots, wilting
- **Pest Damage** - holes, bite marks, insects
- **Structural Issues** - broken leaves, weak stems
- **Actionable Recommendations** - what to do next

### Pass/Fail Criteria

- **80-100**: PASS (healthy plants)
- **60-79**: PASS WITH NOTES (minor issues noted)
- **0-59**: FAIL (requires intervention)

## Setup Requirements

### Environment Variables

```bash
OPENAI_API_KEY=sk-...your-key-here
```

### Installation

```bash
pip install openai>=1.10.0
```

Already included in `requirements.txt`

### Fallback Mode

If OpenAI API is not configured:
- System returns default passing grade (85/100)
- Manual review recommended message shown
- Photo still captured and stored
- QA checkpoint still created
- No errors or failures

## API Endpoints

### Analyze Single Photo

```bash
POST /api/qa/analyze-photo
Content-Type: multipart/form-data

photo: [file]
crop_type: "Butterhead Lettuce" (optional)
checkpoint_type: "GERMINATION" (optional)
```

**Response:**
```json
{
  "ok": true,
  "analysis": {
    "health_score": 92,
    "assessment": "healthy",
    "color_quality": "vibrant green with excellent coloration",
    "size_growth": "appropriate size for growth stage",
    "disease_signs": "no visible disease",
    "pest_damage": "no pest damage detected",
    "structural_issues": "strong structure",
    "recommendations": ["continue current care", "monitor for pests"],
    "pass_qa": true,
    "ai_available": true
  }
}
```

### Checklist Photo QA (Complete Workflow)

```bash
POST /api/qa/checklist-photo
Content-Type: multipart/form-data

photo: [file]
tray_code: "TRAY-001"
checklist_item: "Check germination rate"
crop_type: "Kale" (optional)
weight_kg: 2.5 (optional)
```

**Response:**
```json
{
  "ok": true,
  "qa_checkpoint": {
    "tray_code": "TRAY-001",
    "checkpoint_type": "GERMINATION",
    "result": "PASS",
    "ai_analysis": {...},
    "notes": "Checklist item: Check germination rate. AI Health Score: 92/100"
  },
  "analysis": {...}
}
```

## Data Storage

### QA Checkpoint Records

Each photo QA creates a checkpoint record with:
- `tray_code` - links to batch traceability
- `checkpoint_type` - GERMINATION, GROWTH_MIDPOINT, PRE_HARVEST, etc.
- `checklist_item` - which checklist task triggered it
- `result` - PASS, PASS_WITH_NOTES, FAIL, PENDING
- `photo_data` - Base64 encoded image
- `ai_analysis` - Full AI assessment results
- `timestamp` - When photo was taken
- `inspector` - "Farm Checklist (Auto)"
- `metrics` - Optional weight data

### Photo Storage

Photos are stored as Base64 in checkpoint records. For production:
- Consider moving to S3/cloud storage
- Store URLs instead of Base64
- Implement photo compression
- Add retention policies

## Benefits vs Traditional QA

### Traditional QA System Problems:
- ❌ Requires dedicated inspection rounds (extra time)
- ❌ Manual photo taking at 8 checkpoints (burden)
- ❌ Manual data entry for each checkpoint (repetitive)
- ❌ Easy to forget or skip checkpoints (compliance gaps)
- ❌ No immediate feedback (wait for review)

### Integrated Checklist QA:
- ✅ Happens during existing daily tasks (zero extra time)
- ✅ Photo capture integrated with iPad workflow
- ✅ Automatic AI analysis (instant feedback)
- ✅ Auto-completion of checklist items (motivation)
- ✅ Progressive enhancement (works without AI)
- ✅ Grower carries device anyway (no special equipment)

## Future Enhancements

### Possible Additions:
1. **Timelapse Integration** - Auto-capture photos at intervals
2. **Sensor Data Fusion** - Combine with zone temp/humidity
3. **Harvest Weight Prediction** - AI predicts yield from photos
4. **Pest Identification** - Specific pest species detection
5. **Disease Classification** - Match against known disease database
6. **Growth Rate Tracking** - Compare photos over time
7. **Compliance Reports** - Export QA records for audits
8. **Notifications** - Alert if QA fails or issues detected

### Storage Optimization:
1. Move photos to S3
2. Compress images before storage
3. Implement photo deletion after X days
4. Generate thumbnails for UI display

## Cost Considerations

### OpenAI Vision API Pricing (as of 2024):
- GPT-4 Vision: $0.01 per image (high detail)
- GPT-4o-mini: ~$0.002 per image (used by default)

### Example Farm Costs:
- 5 photos per day × $0.002 = $0.01/day
- Monthly cost: ~$0.30
- Annual cost: ~$3.60

**Extremely affordable** for the value provided.

### Free Alternatives:
- AWS Rekognition Custom Labels
- Google Cloud Vision API
- Azure Computer Vision
- TensorFlow Lite (on-device)

## Testing

### Local Testing:

```bash
# Set API key
export OPENAI_API_KEY=sk-...

# Start backend
python -m backend

# Test analyze endpoint
curl -X POST http://localhost:8000/api/qa/analyze-photo \
  -F "photo=@test-plant.jpg" \
  -F "crop_type=Lettuce"
```

### iPad Testing:

1. Open Activity Hub on iPad
2. Go to Daily Checklist
3. Tap "+ Photo QA" on any item
4. Take photo of real tray
5. Scan QR code
6. Check AI results display

## Troubleshooting

### "AI analysis unavailable"
- Check `OPENAI_API_KEY` is set
- Verify API key is valid and has credits
- Check network connectivity
- Review backend logs for errors

### Photos not uploading
- Check camera permissions in browser
- Verify file size < 10MB
- Ensure HTTPS (required for camera access)
- Check backend upload size limits

### QA checkpoints not creating
- Verify tray code is valid
- Check backend API is running
- Review browser console for errors
- Ensure batch exists for tray code

## Architecture

```
Grower → Checklist Item → "+ Photo QA" button
                            ↓
                      Camera Modal
                            ↓
                      Take Photo
                            ↓
                      Scan Tray QR
                            ↓
                   (Optional Weight Entry)
                            ↓
                      Upload to Backend
                            ↓
               /api/qa/checklist-photo endpoint
                            ↓
                  OpenAI Vision API Analysis
                            ↓
                 Create QA Checkpoint Record
                            ↓
              Return Results + Mark Complete
```

## Security Considerations

- Photos may contain sensitive farm data
- Store photos securely (encryption at rest)
- Limit API access with authentication
- Sanitize filenames before storage
- Implement rate limiting on photo endpoints
- Consider GDPR compliance for photo retention

## Support

For issues or questions:
- Check backend logs: `tail -f logs/backend.log`
- Review browser console in dev tools
- Contact support@lightengine.io
- File issue on GitHub repository
