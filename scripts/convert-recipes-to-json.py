#!/usr/bin/env python3
"""
Convert CSV lighting recipes to lighting-recipes.json format
"""
import csv
import json
import os
from pathlib import Path

# Find all CSV files in the recipe directory
recipe_dir = Path("docs/Updated Light recipe/All_Combined_Recipes_with_EC_PH_Veg_Fruit-4")
output_file = Path("public/data/lighting-recipes.json")

crops = {}

for csv_file in recipe_dir.glob("*.csv"):
    # Extract crop name from filename (e.g., "Mei Qing Pak Choi-Table 1__ENV_-Table 1.csv")
    crop_name = csv_file.stem.split("-Table")[0].strip()
    
    # Skip if already processed (some files have multiple versions)
    if crop_name in crops:
        continue
    
    print(f"Processing: {crop_name}")
    
    days_data = []
    
    try:
        with open(csv_file, 'r', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            for row in reader:
                try:
                    day_data = {
                        "day": float(row.get("Day", 0)),
                        "stage": row.get("Stage", ""),
                        "temperature": float(row.get("Temperature (°C)", 0)) if row.get("Temperature (°C)") else None,
                        "blue": float(row.get("Blue (450 nm)", 0)) if row.get("Blue (450 nm)") else 0,
                        "green": float(row.get("Green (%)", 0)) if row.get("Green (%)") else 0,
                        "red": float(row.get("Red (660 nm)", 0)) if row.get("Red (660 nm)") else 0,
                        "far_red": float(row.get("Far-Red (730 nm)", 0)) if row.get("Far-Red (730 nm)") else 0,
                        "ppfd": float(row.get("PPFD (µmol/m²/s)", 0)) if row.get("PPFD (µmol/m²/s)") else 0,
                        "vpd": float(row.get("Target VPD (kPa)", 0)) if row.get("Target VPD (kPa)") else None,
                        "max_humidity": float(row.get("Max Humidity (%)", 0)) if row.get("Max Humidity (%)") else None,
                        "ec": float(row.get("EC", 0)) if row.get("EC") else None,
                        "ph": float(row.get("PH", 0)) if row.get("PH") else None,
                    }
                    days_data.append(day_data)
                except (ValueError, KeyError) as e:
                    print(f"  Skipping row in {crop_name}: {e}")
                    continue
        
        if days_data:
            crops[crop_name] = days_data
            print(f"  ✓ {len(days_data)} days")
    
    except Exception as e:
        print(f"  ✗ Error: {e}")

# Create output
output = {
    "version": "1.0.0",
    "description": "Production lighting recipes from research CSV data",
    "crops": crops
}

# Write to file
output_file.parent.mkdir(parents=True, exist_ok=True)
with open(output_file, 'w', encoding='utf-8') as f:
    json.dump(output, f, indent=2)

print(f"\n✅ Created {output_file}")
print(f"📊 Total crops: {len(crops)}")
