-- Fix prices and units for seeded inventory
-- Farm: FARM-MLTP9LVH-B0B85039 (The Notable Sprout)

UPDATE farm_inventory SET wholesale_price = 3.58, retail_price = 5.50, price = 5.50, quantity_unit = 'lb', unit = 'lb' WHERE farm_id = 'FARM-MLTP9LVH-B0B85039' AND product_id = 'butterhead-lettuce';
UPDATE farm_inventory SET wholesale_price = 3.25, retail_price = 5.00, price = 5.00, quantity_unit = 'lb', unit = 'lb' WHERE farm_id = 'FARM-MLTP9LVH-B0B85039' AND product_id = 'red-leaf-lettuce';
UPDATE farm_inventory SET wholesale_price = 4.55, retail_price = 7.00, price = 7.00, quantity_unit = 'lb', unit = 'lb' WHERE farm_id = 'FARM-MLTP9LVH-B0B85039' AND product_id = 'baby-arugula';
UPDATE farm_inventory SET wholesale_price = 4.23, retail_price = 6.50, price = 6.50, quantity_unit = 'lb', unit = 'lb' WHERE farm_id = 'FARM-MLTP9LVH-B0B85039' AND product_id = 'baby-spinach';
UPDATE farm_inventory SET wholesale_price = 3.90, retail_price = 6.00, price = 6.00, quantity_unit = 'lb', unit = 'lb' WHERE farm_id = 'FARM-MLTP9LVH-B0B85039' AND product_id = 'spring-mix';
UPDATE farm_inventory SET wholesale_price = 3.58, retail_price = 5.50, price = 5.50, quantity_unit = 'lb', unit = 'lb' WHERE farm_id = 'FARM-MLTP9LVH-B0B85039' AND product_id = 'lacinato-kale';
UPDATE farm_inventory SET wholesale_price = 7.80, retail_price = 12.00, price = 12.00, quantity_unit = 'lb', unit = 'lb' WHERE farm_id = 'FARM-MLTP9LVH-B0B85039' AND product_id = 'genovese-basil';
UPDATE farm_inventory SET wholesale_price = 6.50, retail_price = 10.00, price = 10.00, quantity_unit = 'lb', unit = 'lb' WHERE farm_id = 'FARM-MLTP9LVH-B0B85039' AND product_id = 'fresh-cilantro';
UPDATE farm_inventory SET wholesale_price = 7.15, retail_price = 11.00, price = 11.00, quantity_unit = 'lb', unit = 'lb' WHERE farm_id = 'FARM-MLTP9LVH-B0B85039' AND product_id = 'spearmint';
UPDATE farm_inventory SET wholesale_price = 6.50, retail_price = 10.00, price = 10.00, quantity_unit = 'lb', unit = 'lb' WHERE farm_id = 'FARM-MLTP9LVH-B0B85039' AND product_id = 'italian-parsley';
UPDATE farm_inventory SET wholesale_price = 7.15, retail_price = 11.00, price = 11.00, quantity_unit = 'lb', unit = 'lb' WHERE farm_id = 'FARM-MLTP9LVH-B0B85039' AND product_id = 'fresh-dill';
UPDATE farm_inventory SET wholesale_price = 9.10, retail_price = 14.00, price = 14.00, quantity_unit = 'lb', unit = 'lb' WHERE farm_id = 'FARM-MLTP9LVH-B0B85039' AND product_id = 'chives';
UPDATE farm_inventory SET wholesale_price = 11.70, retail_price = 18.00, price = 18.00, quantity_unit = 'lb', unit = 'lb' WHERE farm_id = 'FARM-MLTP9LVH-B0B85039' AND product_id = 'microgreens-mix';
UPDATE farm_inventory SET wholesale_price = 10.40, retail_price = 16.00, price = 16.00, quantity_unit = 'lb', unit = 'lb' WHERE farm_id = 'FARM-MLTP9LVH-B0B85039' AND product_id = 'sunflower-microgreens';
UPDATE farm_inventory SET wholesale_price = 9.75, retail_price = 15.00, price = 15.00, quantity_unit = 'lb', unit = 'lb' WHERE farm_id = 'FARM-MLTP9LVH-B0B85039' AND product_id = 'pea-shoot-microgreens';
UPDATE farm_inventory SET wholesale_price = 11.05, retail_price = 17.00, price = 17.00, quantity_unit = 'lb', unit = 'lb' WHERE farm_id = 'FARM-MLTP9LVH-B0B85039' AND product_id = 'radish-microgreens';

-- Also fix quantity_available to use lb values (not oz)
UPDATE farm_inventory SET quantity_available = manual_quantity_lbs WHERE farm_id = 'FARM-MLTP9LVH-B0B85039';

SELECT product_name || ': $' || wholesale_price || '/' || quantity_unit || ' (qty: ' || quantity_available || ')' as product_summary FROM farm_inventory WHERE farm_id = 'FARM-MLTP9LVH-B0B85039' ORDER BY category;
