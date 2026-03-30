"""
Notification Service for Wholesale Orders
Sends email and SMS notifications to farms and buyers
"""

import os
from typing import List, Dict, Optional
from datetime import datetime
import boto3
from botocore.exceptions import ClientError


class NotificationService:
    """Email/SMS notifications via AWS SES and SNS"""
    
    def __init__(self):
        self.ses_client = boto3.client('ses', region_name=os.getenv('AWS_REGION', 'us-east-1'))
        self.sns_client = boto3.client('sns', region_name=os.getenv('AWS_REGION', 'us-east-1'))
        self.from_email = os.getenv('NOTIFICATIONS_FROM_EMAIL', 'noreply@greenreach.ca')
    
    async def notify_farm_new_order(self, farm_id: str, sub_order: dict, order: dict) -> bool:
        """
        Notify farm about new order requiring verification
        """
        farm_email = await self._get_farm_email(farm_id)
        if not farm_email:
            return False
        
        subject = f"New Wholesale Order #{order['id']} - Action Required"
        
        html_body = f"""
        <html>
        <head>
            <style>
                body {{ font-family: Arial, sans-serif; line-height: 1.6; color: #333; }}
                .container {{ max-width: 600px; margin: 0 auto; padding: 20px; }}
                .header {{ background: #2d5016; color: white; padding: 20px; text-align: center; }}
                .alert {{ background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; }}
                .order-details {{ background: #f5f7f3; padding: 15px; margin: 20px 0; }}
                .items-table {{ width: 100%; border-collapse: collapse; margin: 15px 0; }}
                .items-table th, .items-table td {{ padding: 10px; text-align: left; border-bottom: 1px solid #ddd; }}
                .items-table th {{ background: #e8f4e8; }}
                .button {{ display: inline-block; background: #82c341; color: white; padding: 12px 30px; 
                           text-decoration: none; border-radius: 5px; margin: 10px 5px; }}
                .deadline {{ color: #c53030; font-weight: bold; }}
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>New Wholesale Order</h1>
                </div>
                
                <div class="alert">
                    <strong>Action Required!</strong><br/>
                    You have <span class="deadline">24 hours</span> to verify this order.
                </div>
                
                <div class="order-details">
                    <h3>Order Details</h3>
                    <p><strong>Order Number:</strong> #{order['id']}</p>
                    <p><strong>Buyer:</strong> {order['buyer_name']}</p>
                    <p><strong>Email:</strong> {order['buyer_email']}</p>
                    <p><strong>Delivery Address:</strong><br/>
                       {order['delivery_address']}, {order['delivery_city']}, {order['delivery_province']}</p>
                    <p><strong>Fulfillment:</strong> {order['fulfillment_cadence'].replace('_', ' ').title()}</p>
                    <p><strong>Deadline:</strong> <span class="deadline">{order['verification_deadline']}</span></p>
                </div>
                
                <h3>Items Ordered</h3>
                <table class="items-table">
                    <thead>
                        <tr>
                            <th>Product</th>
                            <th>Quantity</th>
                            <th>Price</th>
                            <th>Subtotal</th>
                        </tr>
                    </thead>
                    <tbody>
                        {''.join([f'''
                        <tr>
                            <td>{item['product_name']}</td>
                            <td>{item['quantity']} {item['unit']}</td>
                            <td>${item['price_per_unit']:.2f}</td>
                            <td>${item['price_per_unit'] * item['quantity']:.2f}</td>
                        </tr>
                        ''' for item in sub_order['items']])}
                    </tbody>
                    <tfoot>
                        <tr>
                            <td colspan="3"><strong>Total</strong></td>
                            <td><strong>${sub_order['sub_total']:.2f}</strong></td>
                        </tr>
                    </tfoot>
                </table>
                
                {f'<div class="order-details"><strong>Delivery Instructions:</strong><br/>{order["delivery_instructions"]}</div>' 
                 if order.get('delivery_instructions') else ''}
                
                <div style="text-align: center; margin: 30px 0;">
                    <a href="{os.getenv('APP_URL')}/wholesale-farm-orders.html" class="button">
                        View & Respond to Order
                    </a>
                </div>
                
                <p style="color: #666; font-size: 14px;">
                    You can accept the order as-is, modify quantities, or decline if you cannot fulfill it.
                    The system will automatically seek alternative farms if you decline.
                </p>
            </div>
        </body>
        </html>
        """
        
        text_body = f"""
        NEW WHOLESALE ORDER - ACTION REQUIRED
        
        Order #{order['id']} from {order['buyer_name']}
        
        You have 24 HOURS to verify this order.
        
        Order Total: ${sub_order['sub_total']:.2f}
        Deadline: {order['verification_deadline']}
        
        Items:
        {chr(10).join([f"- {item['product_name']}: {item['quantity']} {item['unit']} @ ${item['price_per_unit']:.2f}" 
                       for item in sub_order['items']])}
        
        Respond at: {os.getenv('APP_URL')}/wholesale-farm-orders.html
        """
        
        return await self._send_email(farm_email, subject, html_body, text_body)
    
    async def notify_buyer_order_placed(self, order: dict) -> bool:
        """
        Confirm order placement to buyer
        """
        subject = f"Order Confirmation #{order['id']} - GreenReach Wholesale"
        
        html_body = f"""
        <html>
        <head>
            <style>
                body {{ font-family: Arial, sans-serif; line-height: 1.6; color: #333; }}
                .container {{ max-width: 600px; margin: 0 auto; padding: 20px; }}
                .header {{ background: #2d5016; color: white; padding: 20px; text-align: center; }}
                .success {{ background: #d4edda; border-left: 4px solid #38a169; padding: 15px; margin: 20px 0; }}
                .info-box {{ background: #e7f3ff; border-left: 4px solid #3182ce; padding: 15px; margin: 20px 0; }}
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>Order Confirmation</h1>
                </div>
                
                <div class="success">
                    <strong>Thank you for your order!</strong><br/>
                    Your order has been placed successfully.
                </div>
                
                <div class="info-box">
                    <strong>Important: Payment Authorization</strong><br/>
                    Your card has been <strong>authorized for ${order['total_amount']:.2f}</strong>, 
                    but <strong>not charged yet</strong>.<br/><br/>
                    
                    You will only be charged after:<br/>
                    1. Farms confirm their portions (within 24 hours)<br/>
                    2. You pick up your order<br/>
                    3. Pickup is verified with QR code
                </div>
                
                <h3>Order Summary</h3>
                <p><strong>Order Number:</strong> #{order['id']}</p>
                <p><strong>Total Authorized:</strong> ${order['total_amount']:.2f}</p>
                <p><strong>Fulfillment:</strong> {order['fulfillment_cadence'].replace('_', ' ').title()}</p>
                
                <h3>What Happens Next?</h3>
                <ol>
                    <li>Farms have 24 hours to verify your order</li>
                    <li>You'll receive an email if any farms modify quantities</li>
                    <li>Once verified, farms will prepare your items</li>
                    <li>You'll be notified when ready for pickup</li>
                </ol>
                
                <div style="text-align: center; margin: 30px 0;">
                    <a href="{os.getenv('APP_URL')}/wholesale.html?view=orders" 
                       style="display: inline-block; background: #82c341; color: white; 
                              padding: 12px 30px; text-decoration: none; border-radius: 5px;">
                        Track Your Order
                    </a>
                </div>
            </div>
        </body>
        </html>
        """
        
        text_body = f"""
        ORDER CONFIRMATION - #{order['id']}
        
        Thank you for your order!
        
        Total Authorized: ${order['total_amount']:.2f}
        (You will only be charged after pickup is confirmed)
        
        What happens next:
        1. Farms have 24 hours to verify your order
        2. You'll be notified of any quantity changes
        3. Once ready, you'll receive pickup instructions
        
        Track your order: {os.getenv('APP_URL')}/wholesale.html?view=orders
        """
        
        return await self._send_email(order['buyer_email'], subject, html_body, text_body)
    
    async def notify_buyer_modifications(self, order: dict, modified_sub_orders: List[dict]) -> bool:
        """
        Notify buyer that farms have modified the order
        """
        subject = f"Order #{order['id']} - Review Required"
        
        html_body = f"""
        <html>
        <head>
            <style>
                body {{ font-family: Arial, sans-serif; line-height: 1.6; color: #333; }}
                .container {{ max-width: 600px; margin: 0 auto; padding: 20px; }}
                .header {{ background: #2d5016; color: white; padding: 20px; text-align: center; }}
                .warning {{ background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; }}
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>Order Modification</h1>
                </div>
                
                <div class="warning">
                    <strong>Action Required!</strong><br/>
                    {len(modified_sub_orders)} farm(s) have modified your order quantities.
                    Please review and approve the changes.
                </div>
                
                <h3>Modified By:</h3>
                <ul>
                    {''.join([f'<li>{sub["farm_name"]} - {sub["modification_reason"]}</li>' 
                             for sub in modified_sub_orders])}
                </ul>
                
                <div style="text-align: center; margin: 30px 0;">
                    <a href="{os.getenv('APP_URL')}/wholesale-order-review.html?order_id={order['id']}" 
                       style="display: inline-block; background: #ffc107; color: #333; 
                              padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold;">
                        Review Modifications
                    </a>
                </div>
                
                <p style="color: #666;">
                    You can accept the modified order or reject it for a full refund of your authorization.
                </p>
            </div>
        </body>
        </html>
        """
        
        text_body = f"""
        ORDER MODIFICATION - ACTION REQUIRED
        
        Order #{order['id']} has been modified by farms.
        
        Please review the changes and approve or reject.
        
        Review at: {os.getenv('APP_URL')}/wholesale-order-review.html?order_id={order['id']}
        """
        
        return await self._send_email(order['buyer_email'], subject, html_body, text_body)
    
    async def notify_farm_verification_deadline(self, farm_id: str, sub_order_id: int, hours_left: int) -> bool:
        """
        Send reminder about approaching verification deadline
        """
        farm_email = await self._get_farm_email(farm_id)
        if not farm_email:
            return False
        
        subject = f"Reminder: Order Verification Deadline - {hours_left} hours left"
        
        html_body = f"""
        <html>
        <body style="font-family: Arial, sans-serif; padding: 20px;">
            <div style="background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px;">
                <strong>Verification Deadline Approaching!</strong><br/>
                You have <strong>{hours_left} hours</strong> left to respond to wholesale order.
            </div>
            
            <p>Sub-Order #{sub_order_id} requires your verification.</p>
            
            <div style="text-align: center; margin: 30px 0;">
                <a href="{os.getenv('APP_URL')}/wholesale-farm-orders.html" 
                   style="display: inline-block; background: #c53030; color: white; 
                          padding: 12px 30px; text-decoration: none; border-radius: 5px;">
                    Respond Now
                </a>
            </div>
        </body>
        </html>
        """
        
        text_body = f"""
        URGENT: VERIFICATION DEADLINE APPROACHING
        
        You have {hours_left} hours left to respond to Sub-Order #{sub_order_id}.
        
        Respond at: {os.getenv('APP_URL')}/wholesale-farm-orders.html
        """
        
        return await self._send_email(farm_email, subject, html_body, text_body)
    
    async def _send_email(self, to_email: str, subject: str, html_body: str, text_body: str) -> bool:
        """
        Send email via AWS SES
        """
        try:
            response = self.ses_client.send_email(
                Source=self.from_email,
                Destination={'ToAddresses': [to_email]},
                Message={
                    'Subject': {'Data': subject},
                    'Body': {
                        'Html': {'Data': html_body},
                        'Text': {'Data': text_body}
                    }
                }
            )
            print(f"Email sent to {to_email}: {response['MessageId']}")
            return True
        except ClientError as e:
            print(f"Failed to send email to {to_email}: {e}")
            return False
    
    async def _send_sms(self, phone: str, message: str) -> bool:
        """
        Send SMS via AWS SNS
        """
        try:
            response = self.sns_client.publish(
                PhoneNumber=phone,
                Message=message
            )
            print(f"SMS sent to {phone}: {response['MessageId']}")
            return True
        except ClientError as e:
            print(f"Failed to send SMS to {phone}: {e}")
            return False
    
    async def _get_farm_email(self, farm_id: str) -> Optional[str]:
        """
        Get farm contact email from database
        """
        # TODO: Query farms table for contact email
        # For demo, return a placeholder
        return f"farm-{farm_id}@greenreach.ca"
