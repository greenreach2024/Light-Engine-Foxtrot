"""
Centralized Demo Data Configuration
=====================================

Single source of truth for demo mode across the entire application.

To disable demo data in production:
    1. Set ENABLE_DEMO_DATA = False
    2. Remove demo data initialization calls in affected modules
    3. Or set environment variable: DEMO_MODE=false

Affected Modules:
- backend/inventory_management.py (seeds, packaging, nutrients, equipment, supplies)
- backend/batch_traceability.py (traceability batches and events)
- backend/production_planning.py (production plans and forecasts)
- backend/quality_control.py (QA checkpoints)
- backend/network_dashboard.py (farm network data)
- backend/sustainability_esg.py (carbon footprint, energy, water)
- backend/grower_management.py (grower network)

Frontend Demo Detection:
- All pages check: window.DEMO_MODE || URL param ?demo=1
- Farm sales/store: default demo mode unless ?demo=0
"""

import os
from typing import Dict, Any

# ============================================================================
# MASTER DEMO MODE CONTROL
# ============================================================================

# Set to False to disable ALL demo data across the application
ENABLE_DEMO_DATA = os.getenv("ENABLE_DEMO_DATA", "true").lower() == "true"

# Alternative: Use DEMO_MODE for backward compatibility
DEMO_MODE = os.getenv("DEMO_MODE", "true").lower() == "true"

# Effective demo mode (either flag can enable it)
IS_DEMO_MODE = ENABLE_DEMO_DATA or DEMO_MODE


# ============================================================================
# DEMO DATA CONSTANTS
# ============================================================================

# Default farm ID for demo data
DEMO_FARM_ID = "GR-00001"
DEMO_FARM_NAME = "GreenReach Demo Farm"

# Demo user credentials (for testing only)
DEMO_USERS = {
    "admin": {
        "username": "demo-admin",
        "role": "admin",
        "email": "admin@demo.farm"
    },
    "manager": {
        "username": "demo-manager",
        "role": "manager",
        "email": "manager@demo.farm"
    },
    "staff": {
        "username": "demo-staff",
        "role": "staff",
        "email": "staff@demo.farm"
    }
}


def should_use_demo_data(module_name: str = None) -> bool:
    """
    Check if demo data should be used.
    
    Args:
        module_name: Optional module name for logging
        
    Returns:
        True if demo mode is enabled
    """
    if module_name and IS_DEMO_MODE:
        print(f"[{module_name}] Using demo data (DEMO_MODE={DEMO_MODE})")
    return IS_DEMO_MODE


def get_demo_config() -> Dict[str, Any]:
    """
    Get demo configuration for all modules.
    
    Returns:
        Dict with demo settings
    """
    return {
        "enabled": IS_DEMO_MODE,
        "farm_id": DEMO_FARM_ID,
        "farm_name": DEMO_FARM_NAME,
        "users": DEMO_USERS,
        "features": {
            "inventory": IS_DEMO_MODE,
            "traceability": IS_DEMO_MODE,
            "planning": IS_DEMO_MODE,
            "quality": IS_DEMO_MODE,
            "sustainability": IS_DEMO_MODE,
            "growers": IS_DEMO_MODE,
            "network": IS_DEMO_MODE
        }
    }


# ============================================================================
# PRODUCTION CHECKLIST
# ============================================================================

def get_production_checklist() -> Dict[str, Any]:
    """
    Return checklist for disabling demo data in production.
    
    Returns:
        Dict with checklist items and status
    """
    checklist = {
        "environment_variable": {
            "name": "ENABLE_DEMO_DATA or DEMO_MODE",
            "required_value": "false",
            "current_value": "true" if IS_DEMO_MODE else "false",
            "status": "✓" if not IS_DEMO_MODE else "✗ DEMO MODE ACTIVE"
        },
        "modules_to_update": {
            "inventory_management.py": "Remove initialize_demo_data() call (line 354)",
            "batch_traceability.py": "Remove _init_demo_data() call (line 87)",
            "production_planning.py": "Remove _init_demo_data() call (line 133)",
            "quality_control.py": "Remove _init_demo_data() call (line 153)",
            "network_dashboard.py": "Remove _init_demo_data() call (line 45)",
            "sustainability_esg.py": "Remove generate_demo_data() calls (lines 203, 295)",
            "grower_management.py": "Remove initialize_demo_data() call (line 375)"
        },
        "frontend_checks": {
            "farm-sales.html": "Line 914: isDemoMode check",
            "farm-store.html": "Line 805: isDemoMode check",
            "app.foxtrot.js": "Line 6202: isDemoMode check",
            "wholesale.js": "Line 34-36: demoMode checks"
        }
    }
    return checklist


if __name__ == "__main__":
    # Print current demo mode status
    print("=" * 70)
    print("DEMO MODE CONFIGURATION")
    print("=" * 70)
    print(f"IS_DEMO_MODE: {IS_DEMO_MODE}")
    print(f"ENABLE_DEMO_DATA: {ENABLE_DEMO_DATA}")
    print(f"DEMO_MODE: {DEMO_MODE}")
    print()
    
    if IS_DEMO_MODE:
        print("⚠️  WARNING: Demo mode is ACTIVE")
        print()
        print("To disable demo data for production:")
        print("  1. Set environment variable: ENABLE_DEMO_DATA=false")
        print("  2. Or set: DEMO_MODE=false")
        print("  3. Restart the application")
        print()
        print("See production checklist:")
        import json
        print(json.dumps(get_production_checklist(), indent=2))
    else:
        print("✓ Demo mode is DISABLED (production ready)")
