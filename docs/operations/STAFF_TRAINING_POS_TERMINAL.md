# Staff Training Guide - POS Terminal

**Farm Sales Point of Sale System**

---

## Overview

The farm sales POS terminal is your main tool for processing in-person customer sales at the farm stand, farmers market, or retail counter. This guide covers everything you need to confidently run the POS system.

**Training Time:** 30-45 minutes  
**System Access:** [farm-sales-pos.html](public/farm-sales-pos.html)  
**Support Contact:** Farm Manager

---

## Quick Start (5 Minutes)

### Login

1. Open POS terminal on iPad/tablet
2. Enter your credentials
3. System displays your farm name and role

### Make a Sale

1. Click product cards to add items to cart
2. Click "Checkout" button
3. Select payment method (Cash, Card, Store Credit)
4. Process payment
5. Hand customer receipt (paper or email)

---

## Table of Contents

1. [System Navigation](#system-navigation)
2. [Processing Sales](#processing-sales)
3. [Payment Methods](#payment-methods)
4. [Customer Management](#customer-management)
5. [Common Scenarios](#common-scenarios)
6. [Troubleshooting](#troubleshooting)
7. [End of Day Procedures](#end-of-day-procedures)

---

## System Navigation

### Main Tabs

The POS interface has 5 main tabs:

**1. POS Checkout (Default)**
- Product grid with available items
- Shopping cart
- Checkout button
- Current inventory counts

**2. Orders**
- View today's sales
- Search past orders
- Reprint receipts
- Process returns/refunds

**3. Inventory**
- Check product availability
- View current stock levels
- See incoming harvests

**4. Deliveries**
- Local delivery orders
- Scheduled pickups
- Fulfillment status

**5. Food Security**
- Donation tracking
- Food bank orders
- Community programs

### Product Grid

Products are organized by category:
- Leafy Greens (Lettuce, Kale, Chard)
- Herbs (Basil, Cilantro, Parsley)
- Microgreens (Sunflower, Pea Shoots)
- Produce (Tomatoes, Peppers)

Each product card shows:
- Product name
- Price per unit
- Available quantity
- Unit type (lb, bunch, tray)

**Color Coding:**
- Green: In stock (10+ units)
- Yellow: Low stock (1-9 units)
- Gray: Out of stock (0 units)

### Shopping Cart

Located on the right side of screen:
- Lists selected items
- Shows quantity and price per item
- Displays subtotal, tax (8%), and total
- Clear button to empty cart
- Checkout button to process sale

---

## Processing Sales

### Basic Sale Workflow

**Step 1: Add Items to Cart**

```
1. Click product card (e.g., "Lettuce - Green Oakleaf")
2. Product added to cart with quantity 1
3. Click again to add more (quantity increases)
4. Or click on cart item and manually edit quantity
```

**Example Cart:**
```
Lettuce - Green Oakleaf  x2  @$4.50  = $9.00
Basil - Genovese         x1  @$3.00  = $3.00
                         Subtotal:     $12.00
                         Tax (8%):      $0.96
                         Total:        $12.96
```

**Step 2: Review Cart**
- Verify quantities are correct
- Check prices match shelf labels
- Confirm total with customer

**Step 3: Checkout**
1. Click "Checkout" button
2. Modal opens with payment options
3. Select payment method
4. Complete transaction

**Step 4: Provide Receipt**
- Automatic receipt generation
- Email to customer (if provided)
- Print paper receipt (if printer connected)

### Walk-up Customer (No Account)

Most common scenario - customer has no existing account:

1. Add items to cart
2. Click "Checkout"
3. Payment method screen appears
4. Select payment type (Cash, Card)
5. Process payment
6. Transaction complete

Customer info is optional for walk-up sales.

### Registered Customer (With Account)

Customer has account and may have store credits:

1. Add items to cart
2. Click "Checkout"
3. Enter customer email or phone
4. System looks up customer account
5. Displays available store credits if any
6. Checkbox appears: "Apply store credits"
7. Select payment method
8. Process payment
9. Receipt shows credits applied and remaining balance

---

## Payment Methods

### Cash Payment

**Process:**

1. Click "Checkout"
2. Select "Cash" payment method
3. Enter amount tendered by customer
4. System calculates change due
5. Give customer change
6. Transaction complete

**Example:**
```
Total Due: $12.96
Cash Tendered: $20.00
Change Due: $7.04

Breakdown:
1 x $5 bill
2 x $1 bills
0 x quarters
0 x dimes
0 x nickels
4 x pennies
```

**Tips:**
- Always count change back to customer
- Keep denominations organized in cash drawer
- Watch for counterfeit bills on large purchases
- Maximum cash transaction: $500 (manager override required)

### Card Payment (Square)

**Process:**

1. Click "Checkout"
2. Select "Card" payment method
3. Card entry screen appears
4. Customer inserts/swipes/taps card on Square Reader
5. Wait for approval (3-5 seconds)
6. Transaction complete

**Card Entry Methods:**
- **Chip Insert:** Most secure, preferred
- **Swipe:** Magnetic stripe (backup)
- **Tap:** Contactless (Apple Pay, Google Pay, NFC cards)

**Troubleshooting Card Payments:**
- "Card Declined" - Ask customer to try different card
- "Reader Not Connected" - Check USB connection, restart reader
- "Processing Error" - Try swipe instead of chip
- "Timeout" - Cancel and retry

**Important:**
- Never manually enter card numbers (PCI violation)
- Keep Square Reader charged
- Clean card reader weekly with alcohol wipe

### Store Credits

**When to Use:**
- Customer has store credit balance
- Previous return/refund issued
- Loyalty rewards program
- Gift cards

**Process:**

1. Click "Checkout"
2. Enter customer email/phone
3. System displays credit balance: "$25.00 available"
4. Check "Apply store credits" box
5. System applies credits to total
6. Select payment method for remaining balance (if any)
7. Transaction complete

**Example:**
```
Order Total: $32.50
Store Credits Applied: $25.00
Remaining Due: $7.50 (paid with cash/card)

New Credit Balance: $0.00
```

**Credit-Only Transaction:**
If credits cover full amount:
1. Check "Apply store credits"
2. System shows $0.00 remaining
3. No additional payment needed
4. Transaction complete

**Checking Credit Balance:**
- Customer Management tab
- Enter email/phone
- View transaction history and current balance

---

## Customer Management

### Looking Up Customers

**From Orders Tab:**
1. Click "Orders" tab
2. Use search box
3. Enter email, phone, or name
4. View customer order history

**From Checkout:**
1. During checkout
2. Enter email or phone in customer field
3. System auto-fills name if account exists
4. Shows credit balance

### Creating Customer Accounts

Customers can create accounts to:
- Track purchase history
- Receive store credits
- Get email receipts
- Access loyalty rewards

**Quick Account Creation:**
1. During checkout
2. Check "Create account" box
3. Enter: Name, Email, Phone
4. Account created automatically

**Full Account Creation:**
1. Customer Management tab
2. Click "Add Customer"
3. Fill in details:
   - Name (required)
   - Email (required)
   - Phone (recommended)
   - Address (optional)
   - Notes (optional)
4. Click "Save"

### Store Credits Management

**Issuing Credits:**
- Returns/refunds
- Loyalty rewards
- Promotional credits
- Gift cards

**Viewing Credit History:**
1. Customer Management
2. Search customer
3. View "Credit Transactions" list
4. Shows: Date, Amount, Reason, Balance

**Manual Credit Adjustment:**
(Manager permission required)
1. Customer Management
2. Select customer
3. Click "Adjust Credits"
4. Enter amount and reason
5. Requires manager PIN

---

## Common Scenarios

### Scenario 1: Busy Farmers Market

**Challenge:** Long line of customers, need speed

**Best Practices:**
1. Pre-stage common items (bunches of kale, bags of lettuce)
2. Round prices to avoid small change (.50 cents, whole dollars)
3. Accept cash only during rush (faster than cards)
4. Have second staff member bag while you ring up
5. Use quick keys for best-sellers

**Speed Tips:**
- Keep cart cleared between customers
- Have bags/containers ready
- Pre-calculate common totals mentally
- Use "Repeat Last Order" for CSA box pickups

### Scenario 2: Return/Refund

**Policy:** Returns accepted within 24 hours with receipt

**Process:**
1. Orders tab
2. Search order by receipt ID or customer email
3. Click order
4. Click "Issue Refund" button
5. Select items to refund (or full order)
6. Choose refund method:
   - Store credit (recommended)
   - Original payment method
   - Cash
7. Enter reason for refund
8. Requires manager approval for >$50

**Documentation:**
- System automatically logs all refunds
- Receipt printed/emailed showing credit issued
- Manager reviews refund report daily

### Scenario 3: Price Override

**When Needed:**
- Sale/discount pricing
- Quality issues (bruised, wilted)
- Manager special pricing
- Bulk discounts

**Process:**
1. Add item to cart normally
2. Click on item in cart
3. Click "Override Price"
4. Enter new price
5. Enter reason (required)
6. Requires manager PIN for >20% discount

**Example:**
```
Original: Lettuce $4.50
Override: $3.00 
Reason: "Slight wilting, manager approved"
PIN: [Manager enters PIN]
```

### Scenario 4: Large B2B Order

**Restaurant/Wholesale Order:**

1. Add all items to cart
2. Click "Checkout"
3. Select "Invoice (Net 30)" payment
4. Enter restaurant contact info
5. Add delivery address if applicable
6. Notes field: PO number, special instructions
7. System creates invoice
8. Email/print invoice for customer
9. Order marked as "Pending Payment"

**Follow-up:**
- Orders are tracked separately
- Payment due in 30 days
- Finance sends reminder at 25 days
- Late fees apply after 45 days

### Scenario 5: Gift Card Sale

**Selling Gift Card:**
1. Add "Gift Card" product to cart
2. Enter custom amount (e.g., $50.00)
3. Process payment normally
4. System generates unique code
5. Print code on card or email to recipient

**Redeeming Gift Card:**
1. Click "Checkout"
2. Enter gift card code
3. System loads as store credit
4. Customer can use immediately

### Scenario 6: Split Payment

**Customer wants to pay with multiple methods:**

**Not Currently Supported - Workaround:**
1. Create first transaction for partial amount
2. Apply store credit or cash
3. Create second transaction for remaining amount
4. Use different payment method
5. Mark both orders with note "Split payment"

**Better Approach:**
- Encourage customers to use single payment
- Suggest loading gift card with cash, then use card for total

---

## Troubleshooting

### Issue: Item Not in Product Grid

**Cause:** Out of stock or not yet added to inventory

**Solution:**
1. Check inventory tab - verify stock level
2. If harvest expected today, wait for harvest
3. If urgent, contact manager to add item manually
4. Alternative: Offer similar product

### Issue: Price Shows $0.00

**Cause:** Product not properly configured

**Solution:**
1. Do NOT complete sale at $0.00
2. Contact manager immediately
3. Manager updates pricing in system
4. Reload POS page to see updated price

### Issue: Card Reader Not Working

**Symptoms:**
- "Reader not connected" error
- No response when card inserted
- Timeout errors

**Solutions:**
1. Check USB cable connection
2. Restart Square Reader (power button)
3. Unplug and replug USB
4. Restart iPad/tablet
5. Use manual entry backup (manager only)
6. Accept cash as alternative

### Issue: Receipt Printer Jammed

**Symptoms:**
- Paper not feeding
- Garbled printing
- Error lights blinking

**Solutions:**
1. Open printer cover
2. Remove jammed paper
3. Check paper roll installed correctly
4. Clean print head with alcohol wipe
5. Close cover and test print
6. If still broken, email receipts instead

### Issue: System Running Slow

**Symptoms:**
- Laggy product selection
- Checkout takes >10 seconds
- Spinning wheel/loading indicator

**Solutions:**
1. Close other apps running on tablet
2. Check wifi connection strength
3. Clear browser cache (Settings → Clear Data)
4. Restart tablet
5. Switch to backup device if available

### Issue: Wrong Item Added to Cart

**Solution:**
1. Click item in cart
2. Click trash icon to remove
3. Or change quantity to 0
4. Add correct item

### Issue: Customer Disputes Price

**Solution:**
1. Check shelf label at farm stand
2. Verify price in inventory system
3. If discrepancy, honor shelf price
4. Flag for manager to update system
5. Use price override if needed

---

## End of Day Procedures

### Cash Out Procedure

**Timing:** At close of business or shift change

**Steps:**

1. **Count Cash Drawer**
   - Remove all cash from drawer
   - Count by denomination
   - Record totals on cash-out sheet

2. **Generate Session Summary**
   ```
   Orders Tab → Session Summary
   
   Date: Today
   Cashier: Your Name
   Shift: 8:00 AM - 5:00 PM
   ```

3. **Review Summary Report**
   ```
   Total Transactions: 47
   Total Items Sold: 156
   Gross Sales: $1,247.50
   Tax Collected: $99.80
   Total Revenue: $1,347.30
   
   By Payment Method:
   - Cash: $845.00 (28 transactions)
   - Card: $502.30 (19 transactions)
   - Credit: $0.00 (0 transactions)
   
   By Category:
   - Leafy Greens: $782.40
   - Herbs: $234.50
   - Microgreens: $330.40
   ```

4. **Reconcile Cash**
   ```
   Starting Cash: $200.00 (from morning)
   Cash Sales: $845.00
   Expected in Drawer: $1,045.00
   Actual Counted: $1,045.00
   Variance: $0.00
   ```

5. **Prepare Bank Deposit**
   - Bundle bills by denomination
   - Roll coins
   - Leave starting cash ($200) for next day
   - Deposit rest: $845.00
   - Complete deposit slip

6. **Log Out**
   - Save session summary
   - Log out of POS system
   - Turn off card reader
   - Secure cash in safe

### Shift Change

**Outgoing Cashier:**
1. Complete cash-out (steps above)
2. Print/save summary report
3. Count drawer for incoming cashier
4. Note any issues in shift log

**Incoming Cashier:**
1. Verify starting cash ($200)
2. Test card reader
3. Check receipt paper
4. Log in to POS
5. Begin new session

### Weekly Procedures

**Every Monday Morning:**
1. Review previous week sales report
2. Verify all transactions reconciled
3. Submit inventory variance report
4. Restock receipt paper and supplies

---

## Best Practices

### Speed & Efficiency

1. **Memorize Common Items**
   - Top 10 products = 80% of sales
   - Learn prices by heart
   - Know which button to click without looking

2. **Keep Workspace Organized**
   - Cash drawer sorted by denomination
   - Bags/containers within reach
   - Scale positioned for easy access
   - Credit card reader in prominent spot

3. **Minimize Clicks**
   - Use product quick-keys
   - Avoid unnecessary navigation
   - Keep checkout flow linear

4. **Batch Similar Tasks**
   - Process all cash sales during rush
   - Accept cards during slower periods
   - Save receipt printing for after checkout

### Customer Service

1. **Greet Every Customer**
   - Smile and make eye contact
   - "Welcome to [Farm Name]!"
   - Ask how you can help

2. **Educate About Products**
   - Share harvest dates
   - Suggest recipes
   - Explain growing methods

3. **Handle Issues Gracefully**
   - Stay calm with difficult customers
   - Offer solutions, not excuses
   - Get manager for serious problems

4. **Thank Customers**
   - Sincere appreciation
   - Invite them back
   - Mention upcoming harvests

### Security

1. **Cash Handling**
   - Never leave drawer open unattended
   - Count change twice
   - Watch for counterfeit bills
   - Deposit large bills in safe immediately

2. **Card Security**
   - Never write down card numbers
   - Don't let customers behind counter
   - Secure card reader when not in use

3. **System Access**
   - Log out when leaving terminal
   - Don't share passwords
   - Report suspicious activity

---

## Training Checklist

New staff member should complete all tasks:

### Day 1: Basics

- [ ] Log in to POS system
- [ ] Navigate all 5 tabs
- [ ] Add items to cart
- [ ] Clear cart
- [ ] Process cash sale
- [ ] Calculate change correctly
- [ ] Process card sale
- [ ] Email receipt to customer
- [ ] Print paper receipt

### Day 2: Intermediate

- [ ] Look up past order
- [ ] Search for customer
- [ ] Process sale with store credit
- [ ] Issue refund for return
- [ ] Override price with manager approval
- [ ] Handle out-of-stock item
- [ ] Process split payment (workaround)
- [ ] Generate session summary

### Day 3: Advanced

- [ ] Complete full cash-out procedure
- [ ] Count and reconcile drawer
- [ ] Handle card reader issue
- [ ] Replace receipt paper
- [ ] Process B2B invoice order
- [ ] Sell and redeem gift card
- [ ] Handle busy rush period
- [ ] Train another new staff member

### Certification

- [ ] Pass written quiz (20 questions)
- [ ] Complete 10 supervised transactions
- [ ] Process solo during slow period
- [ ] Handle customer complaint successfully
- [ ] Complete cash-out independently
- [ ] Manager signs off on competency

---

## Quick Reference Card

Print and laminate for POS station:

```
FARM SALES POS - QUICK REFERENCE

LOGIN
URL: [Your Farm URL]/farm-sales-pos.html
User: [Your Username]
Pass: [Your Password]

BASIC SALE
1. Click products to add to cart
2. Click "Checkout"
3. Select payment method
4. Process payment
5. Provide receipt

PAYMENT METHODS
- Cash: Enter tendered, give change
- Card: Customer inserts/taps on reader
- Credit: Enter email, apply credits

COMMON ISSUES
- No product? Check inventory
- Reader issue? Restart reader
- Wrong price? Use override (manager PIN)
- Return? Find order, issue refund

END OF DAY
1. Generate session summary
2. Count cash drawer
3. Prepare deposit
4. Log out

MANAGER PHONE: [Phone Number]
TECH SUPPORT: [Support Email]
```

---

## Additional Resources

- [Square Payment Setup Guide](SQUARE_PAYMENT_SETUP.md)
- [Thermal Printer Setup](THERMAL_PRINTER_SETUP.md)
- [Email Receipt Configuration](EMAIL_SETUP_GUIDE.md)
- [Customer Management Guide](Coming Soon)
- [Inventory Management Training](Coming Soon)

---

## FAQ

**Q: What if a customer doesn't have exact change?**  
A: Use the cash calculator - enter amount tendered, system calculates change with bill/coin breakdown.

**Q: Can I give discounts without manager approval?**  
A: Up to 10% discount allowed without PIN. 10-20% requires reason. Over 20% needs manager PIN.

**Q: What if card reader stops working mid-day?**  
A: Accept cash only, inform customers, call manager. Backup reader available in office.

**Q: How do I reprint a receipt?**  
A: Orders tab → Search order → Click order → "Reprint Receipt" button.

**Q: Can customers pay half cash, half card?**  
A: Not directly. Create two separate transactions for each payment portion.

**Q: What if customer wants to return opened item?**  
A: Cannot accept opened perishables. Offer exchange for different product instead.

**Q: How long is training?**  
A: 3 days supervised + certification. Most staff comfortable by day 2.

**Q: Can I use POS from my phone?**  
A: System works on any device with browser. Tablet/iPad recommended for better experience.

---

**Training Complete!** You're ready to run the farm sales POS terminal. Remember: Practice makes perfect. Don't hesitate to ask questions!

**Version:** 1.0  
**Last Updated:** December 31, 2025  
**Next Review:** March 2026