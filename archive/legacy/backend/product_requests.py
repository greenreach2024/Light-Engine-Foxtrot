"""
Product Request System - Buyer "Foraging" Feature
Allows buyers to request products they can't find, notifies matching farms
"""

from datetime import datetime, timedelta
from typing import Optional, List, Dict
from enum import Enum

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel

router = APIRouter(prefix="/api/wholesale/product-requests", tags=["product_requests"])


class RequestStatus(str, Enum):
    OPEN = "open"
    MATCHED = "matched"
    FULFILLED = "fulfilled"
    EXPIRED = "expired"
    CANCELLED = "cancelled"


class ResponseStatus(str, Enum):
    INTERESTED = "interested"
    CAN_FULFILL = "can_fulfill"
    NOT_AVAILABLE = "not_available"


# Pydantic Models
class CreateProductRequest(BaseModel):
    buyer_id: int
    product_name: str
    quantity: float
    unit: str
    needed_by_date: str  # ISO format
    description: Optional[str] = None
    certifications_required: Optional[List[str]] = []
    max_price_per_unit: Optional[float] = None


class FarmResponse(BaseModel):
    request_id: int
    farm_id: str
    status: ResponseStatus
    available_quantity: Optional[float] = None
    price_per_unit: Optional[float] = None
    available_date: Optional[str] = None
    notes: Optional[str] = None


# Placeholder database
class ProductRequestDB:
    """Placeholder for database operations"""
    
    @staticmethod
    async def create_request(request_data: dict) -> dict:
        """Create a new product request"""
        request_id = 1001  # Would be auto-generated
        return {
            'id': request_id,
            'buyer_id': request_data['buyer_id'],
            'product_name': request_data['product_name'],
            'quantity': request_data['quantity'],
            'unit': request_data['unit'],
            'needed_by_date': request_data['needed_by_date'],
            'description': request_data.get('description'),
            'certifications_required': request_data.get('certifications_required', []),
            'max_price_per_unit': request_data.get('max_price_per_unit'),
            'status': RequestStatus.OPEN,
            'created_at': datetime.utcnow().isoformat(),
            'response_count': 0,
            'matched_farms': []
        }
    
    @staticmethod
    async def get_buyer_requests(buyer_id: int, status: Optional[str] = None) -> List[dict]:
        """Get all requests for a buyer"""
        # Demo data
        return [
            {
                'id': 1001,
                'product_name': 'Cherry Tomatoes',
                'quantity': 50,
                'unit': 'lbs',
                'needed_by_date': '2025-12-30',
                'status': RequestStatus.OPEN,
                'created_at': '2025-12-20T10:00:00',
                'response_count': 3,
                'matched_farms': ['GR-00001', 'GR-00002']
            }
        ]
    
    @staticmethod
    async def get_farm_matches(request_id: int) -> List[dict]:
        """Get farms that match a request based on their products"""
        # Would query farms with matching product categories
        return [
            {
                'farm_id': 'GR-00001',
                'farm_name': 'Green Valley Organics',
                'match_score': 95,
                'has_certification': True,
                'typical_products': ['Tomatoes', 'Peppers', 'Lettuce']
            },
            {
                'farm_id': 'GR-00002',
                'farm_name': 'Sunrise Farms',
                'match_score': 88,
                'has_certification': True,
                'typical_products': ['Tomatoes', 'Cucumbers', 'Herbs']
            }
        ]
    
    @staticmethod
    async def create_farm_response(response_data: dict) -> dict:
        """Farm responds to a product request"""
        return {
            'id': 501,
            'request_id': response_data['request_id'],
            'farm_id': response_data['farm_id'],
            'status': response_data['status'],
            'available_quantity': response_data.get('available_quantity'),
            'price_per_unit': response_data.get('price_per_unit'),
            'available_date': response_data.get('available_date'),
            'notes': response_data.get('notes'),
            'created_at': datetime.utcnow().isoformat()
        }
    
    @staticmethod
    async def get_request_responses(request_id: int) -> List[dict]:
        """Get all farm responses for a request"""
        return [
            {
                'id': 501,
                'farm_id': 'GR-00001',
                'farm_name': 'Green Valley Organics',
                'status': ResponseStatus.CAN_FULFILL,
                'available_quantity': 60,
                'price_per_unit': 4.50,
                'available_date': '2025-12-28',
                'notes': 'Certified organic cherry tomatoes, red and yellow varieties available',
                'created_at': '2025-12-21T08:30:00'
            }
        ]


# === BUYER ENDPOINTS ===

@router.post("/create")
async def create_product_request(request: CreateProductRequest):
    """
    Buyer creates a product request
    System automatically notifies matching farms
    """
    try:
        # Create the request
        new_request = await ProductRequestDB.create_request(request.dict())
        
        # Find matching farms based on product categories
        matches = await ProductRequestDB.get_farm_matches(new_request['id'])
        
        # TODO: Send email/notification to matched farms
        # await notify_farms(matches, new_request)
        
        return {
            'ok': True,
            'request': new_request,
            'matched_farms': len(matches),
            'message': f'Request created! {len(matches)} farms have been notified.'
        }
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/buyer/{buyer_id}")
async def get_buyer_requests(buyer_id: int, status: Optional[str] = None):
    """Get all product requests for a buyer"""
    try:
        requests = await ProductRequestDB.get_buyer_requests(buyer_id, status)
        return {
            'ok': True,
            'requests': requests,
            'total': len(requests)
        }
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{request_id}/responses")
async def get_request_responses(request_id: int):
    """Get all farm responses for a specific request"""
    try:
        responses = await ProductRequestDB.get_request_responses(request_id)
        return {
            'ok': True,
            'responses': responses,
            'total': len(responses)
        }
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{request_id}/cancel")
async def cancel_request(request_id: int):
    """Buyer cancels a product request"""
    try:
        # Update request status to cancelled
        # TODO: Implement database update
        
        return {
            'ok': True,
            'message': 'Request cancelled successfully'
        }
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# === FARM ENDPOINTS ===

@router.get("/farm/{farm_id}/pending")
async def get_farm_pending_requests(farm_id: str):
    """
    Get product requests that match this farm's capabilities
    Farms see requests they can potentially fulfill
    """
    try:
        # Would query requests matching farm's product categories
        # and filter by certifications if required
        
        # Demo data
        pending_requests = [
            {
                'id': 1001,
                'buyer_name': 'Fresh Market Kingston',
                'product_name': 'Cherry Tomatoes',
                'quantity': 50,
                'unit': 'lbs',
                'needed_by_date': '2025-12-30',
                'description': 'Looking for organic cherry tomatoes, mixed colors preferred',
                'certifications_required': ['Organic'],
                'max_price_per_unit': 5.00,
                'created_at': '2025-12-20T10:00:00',
                'match_reason': 'You grow tomatoes and have organic certification'
            }
        ]
        
        return {
            'ok': True,
            'requests': pending_requests,
            'total': len(pending_requests)
        }
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/farm/respond")
async def farm_respond_to_request(response: FarmResponse):
    """Farm responds to a product request"""
    try:
        new_response = await ProductRequestDB.create_farm_response(response.dict())
        
        # TODO: Notify buyer of new response
        # await notify_buyer(response.request_id, new_response)
        
        return {
            'ok': True,
            'response': new_response,
            'message': 'Response sent to buyer'
        }
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/farm/{farm_id}/responses")
async def get_farm_responses(farm_id: str, status: Optional[str] = None):
    """Get all responses this farm has sent"""
    try:
        # Would query farm's responses
        responses = [
            {
                'id': 501,
                'request_id': 1001,
                'buyer_name': 'Fresh Market Kingston',
                'product_name': 'Cherry Tomatoes',
                'status': ResponseStatus.CAN_FULFILL,
                'available_quantity': 60,
                'price_per_unit': 4.50,
                'created_at': '2025-12-21T08:30:00'
            }
        ]
        
        return {
            'ok': True,
            'responses': responses,
            'total': len(responses)
        }
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
