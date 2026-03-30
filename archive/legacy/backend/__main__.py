"""
Light Engine Charlie - FastAPI Backend Entry Point
Run with: python -m backend
"""
import uvicorn
import os
from backend.mqtt_worker import start_mqtt_worker_background

if __name__ == "__main__":
    port = int(os.getenv("BACKEND_PORT", "8000"))
    host = os.getenv("BACKEND_HOST", "0.0.0.0")
    
    print("=" * 70)
    print("🌱 Light Engine Charlie - Backend + MQTT Worker")
    print("=" * 70)
    print(f" FastAPI Backend: http://{host}:{port}")
    print(f"📡 MQTT Configuration:")
    print(f"   Host: {os.getenv('MQTT_HOST', 'localhost')}")
    print(f"   Port: {os.getenv('MQTT_PORT', '1883')}")
    print(f"   Topics: {os.getenv('MQTT_TOPICS', 'sensors/#')}")
    print("=" * 70)
    
    # Start MQTT worker in background
    mqtt_enabled = os.getenv("MQTT_ENABLED", "true").lower() in ("true", "1", "yes")
    if mqtt_enabled:
        print("\n📡 Starting MQTT worker...")
        try:
            start_mqtt_worker_background()
            print(" MQTT worker started\n")
        except Exception as e:
            print(f" MQTT worker failed to start: {e}")
            print("   Continuing without MQTT ingestion\n")
    else:
        print("\n⏭ MQTT worker disabled (set MQTT_ENABLED=true to enable)\n")
    
    # Start FastAPI server
    uvicorn.run(
        "backend.server:app",  # Use backend.server which has all routes
        host=host,
        port=port,
        reload=False,
        log_level="info"
    )
