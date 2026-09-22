SELECT id, status, total_amount, created_at
FROM orders
WHERE buyer_id = 4821
  AND created_at >= now() - interval '90 days'
ORDER BY created_at DESC
LIMIT 50
