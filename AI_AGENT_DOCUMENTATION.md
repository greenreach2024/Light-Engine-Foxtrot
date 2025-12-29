# AI Agent System Documentation

## Overview

The Light Engine AI Agent is an intelligent assistant that can understand natural language commands and take real actions on your farm automation system. Unlike traditional chatbots that only answer questions, this agent can actually control hardware, modify data, and execute workflows.

## Architecture

### Components

1. **AI Agent Service** (`services/ai-agent.js`)
   - Natural language parsing using OpenAI GPT-4o-mini
   - Intent classification and parameter extraction
   - Action execution engine
   - Safety controls for destructive operations

2. **AI Agent Routes** (`routes/farm-sales/ai-agent.js`)
   - RESTful API endpoints for agent interactions
   - Rate limiting (20 requests/minute per farm)
   - Multi-tenant security with farm-scoped actions
   - Conversation history management

3. **Test Interface** (`public/ai-agent-test.html`)
   - Clean chat UI for testing agent capabilities
   - Real-time status indicators
   - Example commands for quick testing

## Setup

### Prerequisites

1. **OpenAI API Key**: Required for natural language understanding
   ```bash
   export OPENAI_API_KEY="sk-..."
   ```

2. **Optional Model Configuration**: Default is GPT-4o-mini (cost-effective)
   ```bash
   export OPENAI_MODEL="gpt-4o-mini"  # or gpt-4, gpt-3.5-turbo
   ```

### Installation

The AI Agent is automatically available once the OpenAI API key is configured. No additional dependencies needed (axios already installed).

### Cost Estimates

Using GPT-4o-mini:
- Input: ~$0.15 per 1M tokens
- Output: ~$0.60 per 1M tokens
- Average command: ~800 tokens total = **$0.00026 per interaction**
- 1,000 commands/month: ~$0.26/month

Very affordable for single-farm deployments!

## Capabilities

### Lighting Control
- `Turn on the lights` - Activate all lighting zones to 100%
- `Turn off the lights` - Deactivate all lighting zones
- `Set lights to 75%` - Adjust brightness level
- `What's the light status?` - Get current state of all zones
- `Dim the lights` - Set to 50% brightness

### Environment Monitoring
- `What's the temperature?` - Get latest sensor readings
- `Show me humidity levels` - View environmental data
- `Get all sensor readings` - Full environmental report
- `Set fan speed to 75%` - Control ventilation (if supported)

### Inventory Management
- `Show my inventory` - List all products
- `What products do I have?` - Same as above
- `Low stock alert` - Find items below threshold
- `Set basil stock to 50` - Update inventory count
- `Add new product` - Create inventory item (coming soon)

### Order Management
- `List today's orders` - View orders from today
- `Show recent orders` - Last 20 orders
- `Order status for #12345` - Get specific order details
- `How many orders do I have?` - Order count and summary

### Automation Control
- `List automation rules` - View all configured rules
- `Enable rule #5` - Activate automation rule
- `Disable watering rule` - Deactivate rule by name
- `Show my automation` - Full automation status

### Reports & Analytics
- `Generate sales report` - Revenue, orders, average order value
- `Show inventory report` - Total products, units, valuation
- `Export data` - Generate CSV/PDF reports (coming soon)

### System Management
- `System health check` - Full system diagnostics
- `Check status` - Quick health overview
- `Restart service` - Restart specific services (admin only, coming soon)

## API Endpoints

### POST /api/farm-sales/ai-agent/chat
Main interaction endpoint - send command, get response with executed action.

**Request:**
```json
{
  "message": "Turn on the lights",
  "history": [
    {"role": "user", "content": "What's the temperature?"},
    {"role": "assistant", "content": "The current temperature is 72°F"}
  ],
  "confirm_action": false
}
```

**Response (Successful Action):**
```json
{
  "type": "action_completed",
  "intent": {
    "intent": "lighting.turn_on",
    "confidence": 0.95,
    "parameters": {},
    "requires_confirmation": false,
    "response": "I'll turn on the lights now."
  },
  "result": {
    "success": true,
    "message": "All lights turned on to 100%",
    "data": {
      "zones_affected": 3
    }
  },
  "message": "I'll turn on the lights now. All lights turned on to 100%"
}
```

**Response (Confirmation Required):**
```json
{
  "type": "confirmation_required",
  "intent": {
    "intent": "inventory.delete_all",
    "confidence": 0.85,
    "parameters": {},
    "requires_confirmation": true,
    "response": "This will delete all inventory. Are you sure?"
  },
  "message": "This will delete all inventory. Are you sure?"
}
```

To confirm, resend the request with `"confirm_action": true`.

### GET /api/farm-sales/ai-agent/capabilities
List all available agent capabilities and actions.

**Response:**
```json
{
  "capabilities": {
    "lighting": {
      "description": "Control farm lighting systems",
      "actions": ["turn_on", "turn_off", "set_brightness", "get_status"]
    },
    "environment": {
      "description": "Monitor and control environmental conditions",
      "actions": ["get_temperature", "get_humidity", "get_readings"]
    },
    // ... more categories
  },
  "model": "gpt-4o-mini",
  "status": "available"
}
```

### GET /api/farm-sales/ai-agent/status
Check agent status and configuration.

**Response:**
```json
{
  "status": "ready",
  "model": "gpt-4o-mini",
  "api_key_set": true,
  "rate_limit": {
    "max_requests": 20,
    "window_seconds": 60
  }
}
```

### POST /api/farm-sales/ai-agent/feedback
Submit feedback about AI response quality (for future improvements).

**Request:**
```json
{
  "message_id": "msg_123",
  "rating": 5,
  "comment": "Great response!"
}
```

## Security Features

### Rate Limiting
- 20 requests per minute per farm
- Prevents API cost overruns
- Returns 429 status when exceeded

### Multi-Tenant Isolation
- All actions are farm-scoped using `farmAuthMiddleware`
- Agent cannot access data from other farms
- User authentication required for all endpoints

### Action Confirmation
- Destructive actions require explicit confirmation
- Two-step process for high-risk operations
- User must acknowledge before execution

### Audit Logging
- All agent actions are logged
- Includes farm_id, user_id, intent, and result
- Useful for debugging and compliance

## Testing

### Using the Test Interface

1. Start the server:
   ```bash
   npm start
   ```

2. Open the test interface:
   ```
   http://localhost:4000/ai-agent-test.html
   ```

3. Try example commands or type your own

4. Monitor the chat for responses and action results

### Using curl

```bash
# Check status
curl -X GET http://localhost:4000/api/farm-sales/ai-agent/status \
  -H "X-Farm-ID: test-farm-001"

# Send command
curl -X POST http://localhost:4000/api/farm-sales/ai-agent/chat \
  -H "Content-Type: application/json" \
  -H "X-Farm-ID: test-farm-001" \
  -d '{
    "message": "Turn on the lights"
  }'
```

## Extending the Agent

### Adding New Capabilities

1. **Define the capability** in `SYSTEM_CAPABILITIES`:
```javascript
mycategory: {
  description: 'My new feature',
  actions: ['action1', 'action2']
}
```

2. **Update the system prompt** to include the new capability

3. **Add action handler** in `executeAction()`:
```javascript
case 'mycategory':
  return await executeMyAction(action, params, context);
```

4. **Implement the action function**:
```javascript
async function executeMyAction(action, params, context) {
  switch (action) {
    case 'action1':
      // Implementation
      return { success: true, message: 'Done', data: {} };
    default:
      return { success: false, error: 'unknown_action' };
  }
}
```

### Best Practices

1. **Clear Action Names**: Use descriptive category.action format (e.g., `lighting.turn_on`)

2. **Parameter Validation**: Always validate parameters before execution

3. **Error Handling**: Return structured errors with helpful messages

4. **Data Structure**: Keep response data consistent and well-documented

5. **Confirmation for Risk**: Set `requires_confirmation: true` for destructive actions

6. **Test Coverage**: Test both success and failure scenarios

## Troubleshooting

### Agent Not Responding
- Check OpenAI API key is set: `echo $OPENAI_API_KEY`
- Verify status endpoint: `GET /api/farm-sales/ai-agent/status`
- Check server logs for errors

### Rate Limit Errors
- Wait 60 seconds for rate limit to reset
- Reduce request frequency
- Consider increasing `RATE_LIMIT_MAX` in routes file

### Action Execution Failures
- Check farmStores data structure matches expected format
- Verify farm_id is valid and has data
- Review server logs for detailed error messages

### OpenAI API Errors
- Check API key is valid (not expired)
- Verify billing is active on OpenAI account
- Check for service outages: https://status.openai.com

## Future Enhancements

### Planned Features
- [ ] Voice input/output integration
- [ ] Multi-turn conversation context
- [ ] Scheduled actions (e.g., "Water plants at 6pm")
- [ ] Webhook triggers for external integrations
- [ ] Learning from user corrections
- [ ] Custom action templates
- [ ] Agent personality customization
- [ ] Integration with mobile app

### Possible Improvements
- Function calling API (more structured than JSON parsing)
- Local LLM option (privacy, cost reduction)
- Action history and undo capability
- Multi-agent coordination (lighting agent, inventory agent, etc.)
- Proactive suggestions based on system state

## Support

For questions or issues:
1. Check this documentation first
2. Review server logs: `tail -f logs/server.log`
3. Test with curl to isolate UI issues
4. Check OpenAI API status
5. File an issue with reproduction steps

## License

Part of Light Engine Foxtrot - Indoor Farming Automation System
