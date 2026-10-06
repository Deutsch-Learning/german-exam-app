ALTER TABLE subscription_plans
  ADD COLUMN IF NOT EXISTS price_xaf NUMERIC(10, 0) NOT NULL DEFAULT 0
  CHECK (price_xaf >= 0);

ALTER TABLE industrial_subscription_offers
  ADD COLUMN IF NOT EXISTS price_xaf NUMERIC(10, 0) NOT NULL DEFAULT 0
  CHECK (price_xaf >= 0);

UPDATE subscription_plans
SET price_xaf = CASE plan_key
      WHEN 'starter' THEN 2500
      WHEN 'standard' THEN 5900
      WHEN 'intensif' THEN 8900
    END,
    price_eur = ROUND(
      CASE plan_key
        WHEN 'starter' THEN 2500
        WHEN 'standard' THEN 5900
        WHEN 'intensif' THEN 8900
      END / 656.0,
      2
    ),
    currency = 'XAF',
    updated_at = NOW()
WHERE level IN ('B1', 'B2')
  AND plan_key IN ('starter', 'standard', 'intensif');

UPDATE industrial_subscription_offers
SET price_xaf = CASE offer_key
      WHEN 'industrial_1_month' THEN 150000
      WHEN 'industrial_6_months' THEN 600000
      WHEN 'industrial_12_plus_2' THEN 1000000
    END,
    price_eur = ROUND(
      CASE offer_key
        WHEN 'industrial_1_month' THEN 150000
        WHEN 'industrial_6_months' THEN 600000
        WHEN 'industrial_12_plus_2' THEN 1000000
      END / 656.0,
      2
    ),
    currency = 'XAF',
    updated_at = NOW()
WHERE offer_key IN (
  'industrial_1_month',
  'industrial_6_months',
  'industrial_12_plus_2'
);
