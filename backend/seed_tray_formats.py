"""
Seed Standard Tray Formats
Creates default microgreen tray formats (4, 8, 12, 21 hole) and common growing system trays
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.models.base import get_db
from backend.models.inventory import TrayFormat
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
import uuid

# Standard tray formats for microgreens
STANDARD_FORMATS = [
    {
        "name": "Microgreen Tray - 4 Hole",
        "plant_site_count": 4,
        "system_type": "soil",
        "tray_material": "plastic",
        "description": "4-hole 10x20 microgreen tray for larger varieties",
        "target_weight_per_site": 8.0,  # 8 oz per hole = 2 lbs per tray
        "weight_unit": "oz",
        "is_weight_based": True,
        "is_custom": False,
        "is_approved": True
    },
    {
        "name": "Microgreen Tray - 8 Hole",
        "plant_site_count": 8,
        "system_type": "soil",
        "tray_material": "plastic",
        "description": "8-hole 10x20 microgreen tray for medium varieties",
        "target_weight_per_site": 4.0,  # 4 oz per hole = 2 lbs per tray
        "weight_unit": "oz",
        "is_weight_based": True,
        "is_custom": False,
        "is_approved": True
    },
    {
        "name": "Microgreen Tray - 12 Hole",
        "plant_site_count": 12,
        "system_type": "soil",
        "tray_material": "plastic",
        "description": "12-hole 10x20 microgreen tray for small-medium varieties",
        "target_weight_per_site": 2.5,  # 2.5 oz per hole = 1.875 lbs per tray
        "weight_unit": "oz",
        "is_weight_based": True,
        "is_custom": False,
        "is_approved": True
    },
    {
        "name": "Microgreen Tray - 21 Hole",
        "plant_site_count": 21,
        "system_type": "soil",
        "tray_material": "plastic",
        "description": "21-hole 10x20 microgreen tray for small varieties",
        "target_weight_per_site": 1.5,  # 1.5 oz per hole = 1.96 lbs per tray
        "weight_unit": "oz",
        "is_weight_based": True,
        "is_custom": False,
        "is_approved": True
    },
    # Additional common formats
    {
        "name": "NFT Channel - 128 Site",
        "plant_site_count": 128,
        "system_type": "nft",
        "tray_material": "plastic",
        "description": "128-site NFT channel for leafy greens (heads)",
        "target_weight_per_site": 0.0,  # Sold by head, not weight
        "weight_unit": "heads",
        "is_weight_based": False,
        "is_custom": False,
        "is_approved": True
    },
    {
        "name": "Aeroponic Tower - 72 Site",
        "plant_site_count": 72,
        "system_type": "aeroponics",
        "tray_material": "tower",
        "description": "72-site aeroponic tower for vertical growing",
        "target_weight_per_site": 0.0,
        "weight_unit": "heads",
        "is_weight_based": False,
        "is_custom": False,
        "is_approved": True
    },
    {
        "name": "ZipGrow Tower",
        "plant_site_count": 128,
        "system_type": "zipgrow",
        "tray_material": "tower",
        "description": "ZipGrow vertical tower - 128 planting sites",
        "target_weight_per_site": 0.0,
        "weight_unit": "heads",
        "is_weight_based": False,
        "is_custom": False,
        "is_approved": True
    }
]

def seed_formats():
    """Seed standard tray formats into database"""
    db = next(get_db())
    
    try:
        print("🌱 Seeding standard tray formats...")
        
        for format_data in STANDARD_FORMATS:
            # Check if format already exists
            existing = db.query(TrayFormat).filter_by(name=format_data["name"]).first()
            if existing:
                print(f"   ⏭️  Skipping '{format_data['name']}' (already exists)")
                continue
            
            # Create new format
            tray_format = TrayFormat(
                tray_format_id=str(uuid.uuid4()),
                **format_data
            )
            db.add(tray_format)
            print(f"   ✅ Created '{format_data['name']}' ({format_data['plant_site_count']} sites)")
        
        db.commit()
        print(f"\n✅ Seeded {len(STANDARD_FORMATS)} standard tray formats")
        
        # Show summary
        all_formats = db.query(TrayFormat).all()
        print(f"\n📦 Total formats in database: {len(all_formats)}")
        
    except Exception as e:
        print(f"❌ Error seeding formats: {e}")
        db.rollback()
    finally:
        db.close()

if __name__ == "__main__":
    seed_formats()
