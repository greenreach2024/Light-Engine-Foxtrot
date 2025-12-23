"""
Label Printing System - Harvest & Wholesale Packing Labels
Auto-generates printable labels with QR codes for traceability
"""

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import HTMLResponse
from typing import Optional
from datetime import datetime
import qrcode
import io
import base64

router = APIRouter()

def generate_qr_base64(data: str) -> str:
    """Generate QR code as base64 image"""
    qr = qrcode.QRCode(version=1, box_size=10, border=2)
    qr.add_data(data)
    qr.make(fit=True)
    
    img = qr.make_image(fill_color="black", back_color="white")
    buffer = io.BytesIO()
    img.save(buffer, format='PNG')
    buffer.seek(0)
    
    return base64.b64encode(buffer.getvalue()).decode()

@router.get("/api/labels/harvest", response_class=HTMLResponse)
async def generate_harvest_label(
    lot_code: str = Query(..., description="Lot code for the harvest"),
    crop_name: Optional[str] = Query("Unknown Crop"),
    weight: Optional[float] = Query(None),
    weight_unit: Optional[str] = Query("kg"),
    harvest_date: Optional[str] = Query(None)
):
    """Generate printable harvest label with QR code"""
    
    # Use current date if not provided
    if not harvest_date:
        harvest_date = datetime.now().strftime("%b %d, %Y")
    
    # Generate QR code
    qr_data = f"LOT:{lot_code}"
    qr_image = generate_qr_base64(qr_data)
    
    # Generate HTML label
    html = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <title>Harvest Label - {lot_code}</title>
        <style>
            @media print {{
                body {{ margin: 0; }}
                .no-print {{ display: none; }}
            }}
            body {{
                font-family: Arial, sans-serif;
                margin: 20px;
                background: #f5f5f5;
            }}
            .label {{
                width: 4in;
                background: white;
                border: 2px solid #000;
                padding: 15px;
                margin: 0 auto;
                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            }}
            .header {{
                text-align: center;
                border-bottom: 2px solid #000;
                padding-bottom: 10px;
                margin-bottom: 15px;
            }}
            .farm-name {{
                font-size: 18px;
                font-weight: bold;
                color: #2E7D32;
            }}
            .crop-name {{
                font-size: 24px;
                font-weight: bold;
                margin: 10px 0;
                text-align: center;
            }}
            .info-row {{
                display: flex;
                justify-content: space-between;
                margin: 8px 0;
                font-size: 14px;
            }}
            .label-text {{
                font-weight: bold;
            }}
            .qr-section {{
                text-align: center;
                margin: 15px 0;
                padding: 10px;
                border: 1px dashed #ccc;
            }}
            .qr-code {{
                width: 120px;
                height: 120px;
            }}
            .lot-code {{
                font-size: 16px;
                font-weight: bold;
                margin-top: 5px;
                font-family: monospace;
            }}
            .footer {{
                text-align: center;
                font-size: 10px;
                color: #666;
                margin-top: 15px;
                padding-top: 10px;
                border-top: 1px solid #ccc;
            }}
            .print-btn {{
                background: #2E7D32;
                color: white;
                border: none;
                padding: 12px 24px;
                font-size: 16px;
                border-radius: 4px;
                cursor: pointer;
                display: block;
                margin: 20px auto;
            }}
            .print-btn:hover {{
                background: #1B5E20;
            }}
        </style>
    </head>
    <body>
        <button class="print-btn no-print" onclick="window.print()">🖨️ Print Label</button>
        
        <div class="label">
            <div class="header">
                <div class="farm-name">Demo Farm</div>
                <div style="font-size: 12px; color: #666;">Certified Organic</div>
            </div>
            
            <div class="crop-name">{crop_name}</div>
            
            <div class="info-row">
                <span class="label-text">Harvest Date:</span>
                <span>{harvest_date}</span>
            </div>
            
            {f'<div class="info-row"><span class="label-text">Weight:</span><span>{weight} {weight_unit}</span></div>' if weight else ''}
            
            <div class="qr-section">
                <img src="data:image/png;base64,{qr_image}" class="qr-code" alt="QR Code">
                <div class="lot-code">{lot_code}</div>
            </div>
            
            <div class="footer">
                Scan QR code for full traceability<br>
                Keep refrigerated 2-4°C
            </div>
        </div>
        
        <script>
            // Auto-print on load (optional)
            // window.onload = () => setTimeout(() => window.print(), 500);
        </script>
    </body>
    </html>
    """
    
    return html

@router.get("/api/labels/packing", response_class=HTMLResponse)
async def generate_packing_label(
    order_id: str = Query(..., description="Wholesale order ID"),
    buyer_name: str = Query(..., description="Buyer business name"),
    buyer_address: str = Query(..., description="Delivery address"),
    crop_name: str = Query(..., description="Product name"),
    quantity: float = Query(..., description="Quantity"),
    unit: str = Query("kg", description="Unit"),
    lot_codes: str = Query(..., description="Comma-separated lot codes"),
    harvest_date: Optional[str] = Query(None),
    farm_name: Optional[str] = Query("Demo Farm"),
    farm_id: Optional[str] = Query("GR-00001"),
    certification: Optional[str] = Query("Organic (CAN/CGSB-32.310)")
):
    """Generate printable wholesale packing label with traceability"""
    
    # Use current date if not provided
    if not harvest_date:
        harvest_date = datetime.now().strftime("%b %d, %Y")
    
    # Calculate best before date (7 days from now)
    best_before = datetime.now()
    from datetime import timedelta
    best_before = (best_before + timedelta(days=7)).strftime("%b %d, %Y")
    
    # Generate QR code with order + lot data
    qr_data = f"ORDER:{order_id}|LOTS:{lot_codes}|BUYER:{buyer_name}"
    qr_image = generate_qr_base64(qr_data)
    
    # Format lot codes for display
    lot_list = lot_codes.split(',')
    lot_display = '<br>'.join([f"  • {lot.strip()}" for lot in lot_list])
    
    # Generate HTML label
    html = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <title>Packing Label - {order_id}</title>
        <style>
            @media print {{
                body {{ margin: 0; }}
                .no-print {{ display: none; }}
            }}
            body {{
                font-family: Arial, sans-serif;
                margin: 20px;
                background: #f5f5f5;
            }}
            .label {{
                width: 6in;
                background: white;
                border: 3px solid #000;
                padding: 20px;
                margin: 0 auto;
                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            }}
            .header {{
                text-align: center;
                background: #2E7D32;
                color: white;
                padding: 15px;
                margin: -20px -20px 20px -20px;
                font-size: 22px;
                font-weight: bold;
            }}
            .section {{
                margin: 15px 0;
                padding: 10px;
                border: 1px solid #ddd;
                background: #f9f9f9;
            }}
            .section-title {{
                font-size: 14px;
                font-weight: bold;
                color: #2E7D32;
                margin-bottom: 8px;
                text-transform: uppercase;
            }}
            .buyer-info {{
                font-size: 16px;
                line-height: 1.6;
            }}
            .product-name {{
                font-size: 20px;
                font-weight: bold;
                margin: 10px 0;
            }}
            .info-grid {{
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 10px;
                margin: 10px 0;
            }}
            .info-item {{
                padding: 8px;
                background: white;
                border: 1px solid #ddd;
            }}
            .info-label {{
                font-size: 11px;
                color: #666;
                text-transform: uppercase;
            }}
            .info-value {{
                font-size: 16px;
                font-weight: bold;
            }}
            .traceability {{
                background: #FFF9C4;
                border: 2px solid #F57C00;
                padding: 15px;
                margin: 15px 0;
            }}
            .lot-codes {{
                font-family: monospace;
                font-size: 14px;
                line-height: 1.8;
                margin: 5px 0;
            }}
            .qr-section {{
                text-align: center;
                padding: 15px;
                background: white;
                border: 2px dashed #2E7D32;
                margin: 15px 0;
            }}
            .qr-code {{
                width: 150px;
                height: 150px;
            }}
            .footer {{
                text-align: center;
                font-size: 12px;
                padding: 15px;
                border-top: 2px solid #000;
                margin-top: 20px;
                font-weight: bold;
            }}
            .print-btn {{
                background: #2E7D32;
                color: white;
                border: none;
                padding: 15px 30px;
                font-size: 18px;
                border-radius: 4px;
                cursor: pointer;
                display: block;
                margin: 20px auto;
            }}
            .print-btn:hover {{
                background: #1B5E20;
            }}
        </style>
    </head>
    <body>
        <button class="print-btn no-print" onclick="window.print()">🖨️ Print Packing Label</button>
        
        <div class="label">
            <div class="header">
                WHOLESALE PACKING LABEL
            </div>
            
            <div class="section">
                <div class="section-title">Ship To</div>
                <div class="buyer-info">
                    <strong>{buyer_name}</strong><br>
                    {buyer_address}<br>
                    Order #{order_id}
                </div>
            </div>
            
            <div class="section">
                <div class="section-title">Product Information</div>
                <div class="product-name">{crop_name}</div>
                <div class="info-grid">
                    <div class="info-item">
                        <div class="info-label">Quantity</div>
                        <div class="info-value">{quantity} {unit}</div>
                    </div>
                    <div class="info-item">
                        <div class="info-label">Harvest Date</div>
                        <div class="info-value">{harvest_date}</div>
                    </div>
                </div>
            </div>
            
            <div class="traceability">
                <div class="section-title" style="color: #F57C00;">🔍 Traceability Information</div>
                <div style="margin: 10px 0;">
                    <strong>Lot Code(s):</strong><br>
                    <div class="lot-codes">{lot_display}</div>
                </div>
                <div style="margin: 5px 0;">
                    <strong>Farm:</strong> {farm_name} ({farm_id})<br>
                    <strong>Certification:</strong> {certification}
                </div>
            </div>
            
            <div class="qr-section">
                <img src="data:image/png;base64,{qr_image}" class="qr-code" alt="QR Code">
                <div style="margin-top: 10px; font-size: 12px; color: #666;">
                    Scan for complete order & traceability details
                </div>
            </div>
            
            <div class="footer">
                Best Before: {best_before}<br>
                Keep Refrigerated 2-4°C
            </div>
        </div>
        
        <script>
            // Auto-print on load (optional)
            // window.onload = () => setTimeout(() => window.print(), 500);
        </script>
    </body>
    </html>
    """
    
    return html
