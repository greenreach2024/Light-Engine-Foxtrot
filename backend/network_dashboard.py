"""
Multi-Farm Network Dashboard - GreenReach Central
Aggregate metrics and oversight across farm network
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from datetime import datetime, timedelta
from enum import Enum
import statistics

router = APIRouter()

# ============================================================================
# MODELS
# ============================================================================

class FarmStatus(str, Enum):
    """Farm operational status"""
    ONLINE = "online"
    OFFLINE = "offline"
    WARNING = "warning"
    MAINTENANCE = "maintenance"

class FarmMetrics(BaseModel):
    """Farm performance metrics"""
    farm_id: str
    production_kg: float
    revenue: float
    active_batches: int
    qa_score: float
    capacity_utilization: float

# ============================================================================
# DATABASE (PLACEHOLDER)
# ============================================================================

class NetworkDatabase:
    """In-memory database placeholder"""
    
    def __init__(self):
        self.farms = {}
        self.metrics_history = []
        self._init_demo_data()
    
    def _init_demo_data(self):
        """Initialize with demo farm network"""
        
        farms_data = [
            {
                "farm_id": "GR-00001",
                "farm_name": "GreenReach Kingston HQ",
                "location": "Kingston, ON",
                "type": "flagship",
                "capacity": 2000,
                "status": FarmStatus.ONLINE,
                "last_heartbeat": datetime.now().isoformat(),
                "contact": "Peter Gilbert",
                "email": "peter@greenreach.ca"
            },
            {
                "farm_id": "GR-00002",
                "farm_name": "Toronto Urban Farm",
                "location": "Toronto, ON",
                "type": "partner",
                "capacity": 1500,
                "status": FarmStatus.ONLINE,
                "last_heartbeat": (datetime.now() - timedelta(minutes=5)).isoformat(),
                "contact": "Sarah Chen",
                "email": "sarah@torontourban.ca"
            },
            {
                "farm_id": "GR-00003",
                "farm_name": "Ottawa Valley Greens",
                "location": "Ottawa, ON",
                "type": "partner",
                "capacity": 1200,
                "status": FarmStatus.WARNING,
                "last_heartbeat": (datetime.now() - timedelta(hours=2)).isoformat(),
                "contact": "Mike Johnson",
                "email": "mike@ottawagreens.ca"
            },
            {
                "farm_id": "GR-00004",
                "farm_name": "Hamilton Heights Farm",
                "location": "Hamilton, ON",
                "type": "partner",
                "capacity": 1000,
                "status": FarmStatus.ONLINE,
                "last_heartbeat": (datetime.now() - timedelta(minutes=10)).isoformat(),
                "contact": "Emma Davis",
                "email": "emma@hamiltonheights.ca"
            },
            {
                "farm_id": "GR-00005",
                "farm_name": "London Fresh Farms",
                "location": "London, ON",
                "type": "partner",
                "capacity": 800,
                "status": FarmStatus.MAINTENANCE,
                "last_heartbeat": (datetime.now() - timedelta(hours=6)).isoformat(),
                "contact": "David Wilson",
                "email": "david@londonfresh.ca"
            }
        ]
        
        for farm in farms_data:
            self.farms[farm["farm_id"]] = farm
        
        # Generate demo metrics for last 30 days
        for days_ago in range(30):
            date = (datetime.now() - timedelta(days=days_ago)).strftime("%Y-%m-%d")
            
            for farm_id in self.farms.keys():
                # Simulate varying production levels
                base_production = 50 if farm_id == "GR-00001" else 30
                production = base_production + (days_ago % 7) * 5  # Weekly variation
                
                self.metrics_history.append({
                    "farm_id": farm_id,
                    "date": date,
                    "production_kg": production,
                    "revenue": production * 8.5,  # $8.50/kg average
                    "active_batches": 5 + (days_ago % 3),
                    "qa_score": 92 + (days_ago % 8),
                    "capacity_utilization": 70 + (days_ago % 20),
                    "orders_fulfilled": 8 + (days_ago % 5)
                })

db = NetworkDatabase()

# ============================================================================
# API ENDPOINTS
# ============================================================================

@router.get("/api/network/farms/list")
async def list_farms(status: Optional[str] = None, type: Optional[str] = None):
    """List all farms in network"""
    
    farms = list(db.farms.values())
    
    # Apply filters
    if status:
        farms = [f for f in farms if f["status"] == status]
    if type:
        farms = [f for f in farms if f["type"] == type]
    
    # Add current metrics for each farm
    for farm in farms:
        recent_metrics = [m for m in db.metrics_history 
                         if m["farm_id"] == farm["farm_id"]][-1:]
        
        if recent_metrics:
            farm["current_metrics"] = recent_metrics[0]
        else:
            farm["current_metrics"] = None
    
    return {
        "ok": True,
        "farms": farms,
        "total": len(farms)
    }

@router.get("/api/network/farms/{farm_id}")
async def get_farm_details(farm_id: str):
    """Get detailed farm information"""
    
    if farm_id not in db.farms:
        raise HTTPException(status_code=404, detail="Farm not found")
    
    farm = db.farms[farm_id]
    
    # Get metrics history (last 30 days)
    metrics = [m for m in db.metrics_history if m["farm_id"] == farm_id]
    metrics.sort(key=lambda x: x["date"], reverse=True)
    recent_metrics = metrics[:30]
    
    # Calculate trends
    if len(recent_metrics) >= 14:
        recent_14 = recent_metrics[:14]
        previous_14 = recent_metrics[14:28]
        
        recent_production = sum(m["production_kg"] for m in recent_14)
        previous_production = sum(m["production_kg"] for m in previous_14)
        
        production_trend = ((recent_production - previous_production) / previous_production * 100) if previous_production > 0 else 0
    else:
        production_trend = 0
    
    # Calculate averages
    if recent_metrics:
        avg_qa = statistics.mean([m["qa_score"] for m in recent_metrics])
        avg_utilization = statistics.mean([m["capacity_utilization"] for m in recent_metrics])
        total_production = sum(m["production_kg"] for m in recent_metrics)
        total_revenue = sum(m["revenue"] for m in recent_metrics)
    else:
        avg_qa = 0
        avg_utilization = 0
        total_production = 0
        total_revenue = 0
    
    return {
        "ok": True,
        "farm": farm,
        "metrics": {
            "history": recent_metrics[:7],  # Last 7 days
            "summary_30d": {
                "total_production_kg": round(total_production, 1),
                "total_revenue": round(total_revenue, 2),
                "avg_qa_score": round(avg_qa, 1),
                "avg_capacity_utilization": round(avg_utilization, 1),
                "production_trend": round(production_trend, 1)
            }
        }
    }

@router.get("/api/network/dashboard")
async def get_network_dashboard():
    """Get network-wide dashboard overview"""
    
    # Farm status summary
    farms = list(db.farms.values())
    status_counts = {}
    for farm in farms:
        status = farm["status"]
        status_counts[status] = status_counts.get(status, 0) + 1
    
    # Aggregate metrics (last 7 days)
    cutoff_date = (datetime.now() - timedelta(days=7)).strftime("%Y-%m-%d")
    recent_metrics = [m for m in db.metrics_history if m["date"] >= cutoff_date]
    
    total_production = sum(m["production_kg"] for m in recent_metrics)
    total_revenue = sum(m["revenue"] for m in recent_metrics)
    avg_qa_score = statistics.mean([m["qa_score"] for m in recent_metrics]) if recent_metrics else 0
    
    # Production by farm
    production_by_farm = {}
    for metric in recent_metrics:
        farm_id = metric["farm_id"]
        if farm_id not in production_by_farm:
            production_by_farm[farm_id] = 0
        production_by_farm[farm_id] += metric["production_kg"]
    
    # Top performing farms
    top_farms = sorted(production_by_farm.items(), key=lambda x: x[1], reverse=True)[:3]
    top_performers = [
        {
            "farm_id": farm_id,
            "farm_name": db.farms[farm_id]["farm_name"],
            "production_kg": round(production, 1)
        }
        for farm_id, production in top_farms
    ]
    
    # Farms needing attention
    attention_needed = []
    for farm in farms:
        if farm["status"] in [FarmStatus.WARNING, FarmStatus.OFFLINE]:
            attention_needed.append({
                "farm_id": farm["farm_id"],
                "farm_name": farm["farm_name"],
                "status": farm["status"],
                "last_heartbeat": farm["last_heartbeat"]
            })
        
        # Check QA scores
        farm_metrics = [m for m in recent_metrics if m["farm_id"] == farm["farm_id"]]
        if farm_metrics:
            avg_qa = statistics.mean([m["qa_score"] for m in farm_metrics])
            if avg_qa < 85:
                attention_needed.append({
                    "farm_id": farm["farm_id"],
                    "farm_name": farm["farm_name"],
                    "status": "low_qa",
                    "qa_score": round(avg_qa, 1)
                })
    
    # Total network capacity
    total_capacity = sum(f["capacity"] for f in farms)
    
    if recent_metrics:
        recent_avg_util = statistics.mean([m["capacity_utilization"] for m in recent_metrics])
        space_in_use = (recent_avg_util / 100) * total_capacity
    else:
        recent_avg_util = 0
        space_in_use = 0
    
    return {
        "ok": True,
        "dashboard": {
            "network_health": {
                "total_farms": len(farms),
                "online": status_counts.get(FarmStatus.ONLINE, 0),
                "warnings": status_counts.get(FarmStatus.WARNING, 0),
                "offline": status_counts.get(FarmStatus.OFFLINE, 0),
                "maintenance": status_counts.get(FarmStatus.MAINTENANCE, 0)
            },
            "production_7d": {
                "total_production_kg": round(total_production, 1),
                "total_revenue": round(total_revenue, 2),
                "avg_qa_score": round(avg_qa_score, 1),
                "daily_average_kg": round(total_production / 7, 1)
            },
            "capacity": {
                "total_capacity": total_capacity,
                "space_in_use": round(space_in_use, 0),
                "space_available": round(total_capacity - space_in_use, 0),
                "utilization_percent": round(recent_avg_util, 1)
            },
            "top_performers": top_performers,
            "attention_needed": attention_needed
        }
    }

@router.get("/api/network/comparative-analytics")
async def get_comparative_analytics(metric: str = "production", days: int = 30):
    """Get comparative analytics across farms"""
    
    cutoff_date = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")
    recent_metrics = [m for m in db.metrics_history if m["date"] >= cutoff_date]
    
    # Group by farm
    farm_data = {}
    for metric_data in recent_metrics:
        farm_id = metric_data["farm_id"]
        if farm_id not in farm_data:
            farm_data[farm_id] = []
        farm_data[farm_id].append(metric_data)
    
    # Calculate comparison metrics
    comparison = []
    for farm_id, metrics in farm_data.items():
        farm = db.farms[farm_id]
        
        if metric == "production":
            total = sum(m["production_kg"] for m in metrics)
            avg = statistics.mean([m["production_kg"] for m in metrics])
        elif metric == "revenue":
            total = sum(m["revenue"] for m in metrics)
            avg = statistics.mean([m["revenue"] for m in metrics])
        elif metric == "qa_score":
            total = 0
            avg = statistics.mean([m["qa_score"] for m in metrics])
        elif metric == "capacity_utilization":
            total = 0
            avg = statistics.mean([m["capacity_utilization"] for m in metrics])
        else:
            total = 0
            avg = 0
        
        comparison.append({
            "farm_id": farm_id,
            "farm_name": farm["farm_name"],
            "location": farm["location"],
            "total": round(total, 2),
            "average": round(avg, 2),
            "capacity": farm["capacity"],
            "data_points": len(metrics)
        })
    
    # Sort by total/average
    comparison.sort(key=lambda x: x["total"] if metric in ["production", "revenue"] else x["average"], 
                   reverse=True)
    
    # Calculate network totals
    network_total = sum(c["total"] for c in comparison)
    network_average = statistics.mean([c["average"] for c in comparison]) if comparison else 0
    
    return {
        "ok": True,
        "metric": metric,
        "period_days": days,
        "farms": comparison,
        "network_totals": {
            "total": round(network_total, 2),
            "average": round(network_average, 2),
            "highest": comparison[0] if comparison else None,
            "lowest": comparison[-1] if comparison else None
        }
    }

@router.get("/api/network/trends")
async def get_network_trends(days: int = 30):
    """Get network-wide production and quality trends"""
    
    cutoff_date = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")
    recent_metrics = [m for m in db.metrics_history if m["date"] >= cutoff_date]
    
    # Group by date
    daily_totals = {}
    for metric in recent_metrics:
        date = metric["date"]
        if date not in daily_totals:
            daily_totals[date] = {
                "production_kg": 0,
                "revenue": 0,
                "qa_scores": [],
                "utilization": []
            }
        
        daily_totals[date]["production_kg"] += metric["production_kg"]
        daily_totals[date]["revenue"] += metric["revenue"]
        daily_totals[date]["qa_scores"].append(metric["qa_score"])
        daily_totals[date]["utilization"].append(metric["capacity_utilization"])
    
    # Calculate daily averages
    trend_data = []
    for date in sorted(daily_totals.keys()):
        day_data = daily_totals[date]
        
        trend_data.append({
            "date": date,
            "production_kg": round(day_data["production_kg"], 1),
            "revenue": round(day_data["revenue"], 2),
            "avg_qa_score": round(statistics.mean(day_data["qa_scores"]), 1),
            "avg_utilization": round(statistics.mean(day_data["utilization"]), 1)
        })
    
    # Calculate growth rates
    if len(trend_data) >= 14:
        recent_week = trend_data[-7:]
        previous_week = trend_data[-14:-7]
        
        recent_production = sum(d["production_kg"] for d in recent_week)
        previous_production = sum(d["production_kg"] for d in previous_week)
        
        production_growth = ((recent_production - previous_production) / previous_production * 100) if previous_production > 0 else 0
    else:
        production_growth = 0
    
    return {
        "ok": True,
        "period_days": days,
        "trends": trend_data,
        "growth_metrics": {
            "production_growth_7d": round(production_growth, 1),
            "trend": "growing" if production_growth > 5 else "stable" if production_growth > -5 else "declining"
        }
    }

@router.post("/api/network/farms/{farm_id}/heartbeat")
async def update_farm_heartbeat(farm_id: str, status: Optional[FarmStatus] = None):
    """Update farm heartbeat and status"""
    
    if farm_id not in db.farms:
        raise HTTPException(status_code=404, detail="Farm not found")
    
    db.farms[farm_id]["last_heartbeat"] = datetime.now().isoformat()
    
    if status:
        db.farms[farm_id]["status"] = status
    else:
        # Auto-set to online if heartbeat received
        db.farms[farm_id]["status"] = FarmStatus.ONLINE
    
    return {
        "ok": True,
        "farm_id": farm_id,
        "status": db.farms[farm_id]["status"],
        "message": "Heartbeat updated"
    }

@router.get("/api/network/alerts")
async def get_network_alerts():
    """Get network-wide alerts and issues"""
    
    alerts = []
    
    # Check farm connectivity
    for farm in db.farms.values():
        last_heartbeat = datetime.fromisoformat(farm["last_heartbeat"])
        minutes_ago = (datetime.now() - last_heartbeat).total_seconds() / 60
        
        if minutes_ago > 60:
            alerts.append({
                "severity": "high",
                "type": "connectivity",
                "farm_id": farm["farm_id"],
                "farm_name": farm["farm_name"],
                "message": f"No heartbeat for {int(minutes_ago)} minutes",
                "timestamp": datetime.now().isoformat()
            })
        elif farm["status"] == FarmStatus.WARNING:
            alerts.append({
                "severity": "medium",
                "type": "status",
                "farm_id": farm["farm_id"],
                "farm_name": farm["farm_name"],
                "message": "Farm status: WARNING",
                "timestamp": datetime.now().isoformat()
            })
    
    # Check QA scores
    recent_metrics = [m for m in db.metrics_history 
                     if m["date"] >= (datetime.now() - timedelta(days=7)).strftime("%Y-%m-%d")]
    
    farm_qa = {}
    for metric in recent_metrics:
        farm_id = metric["farm_id"]
        if farm_id not in farm_qa:
            farm_qa[farm_id] = []
        farm_qa[farm_id].append(metric["qa_score"])
    
    for farm_id, scores in farm_qa.items():
        avg_qa = statistics.mean(scores)
        if avg_qa < 85:
            alerts.append({
                "severity": "medium",
                "type": "quality",
                "farm_id": farm_id,
                "farm_name": db.farms[farm_id]["farm_name"],
                "message": f"Low QA score: {avg_qa:.1f}%",
                "timestamp": datetime.now().isoformat()
            })
    
    # Sort by severity
    severity_order = {"high": 0, "medium": 1, "low": 2}
    alerts.sort(key=lambda x: severity_order[x["severity"]])
    
    return {
        "ok": True,
        "alerts": alerts,
        "total": len(alerts),
        "high_severity": len([a for a in alerts if a["severity"] == "high"]),
        "medium_severity": len([a for a in alerts if a["severity"] == "medium"])
    }
