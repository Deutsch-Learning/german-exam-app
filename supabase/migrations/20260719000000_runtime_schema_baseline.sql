-- Baseline for the schema that existed before versioned migrations were introduced.
-- This file intentionally mirrors the former runtime schema initializers.
-- On the established production database it is recorded as an applied baseline,
-- not replayed, to avoid locking populated tables.

BEGIN;
-- core application schema (formerly runtime-initialized)
DO $$
    BEGIN
      CREATE TYPE user_role AS ENUM ('user', 'admin');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;

DO $$
    BEGIN
      CREATE TYPE account_status AS ENUM ('active', 'suspended');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;

CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      username TEXT UNIQUE,
      first_name TEXT,
      last_name TEXT,
      date_of_birth DATE,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

ALTER TABLE users ADD COLUMN IF NOT EXISTS username TEXT;

ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name TEXT;

ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name TEXT;

ALTER TABLE users ADD COLUMN IF NOT EXISTS date_of_birth DATE;

ALTER TABLE users ADD COLUMN IF NOT EXISTS country TEXT;

ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;

ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_provider TEXT NOT NULL DEFAULT 'email';

ALTER TABLE users ADD COLUMN IF NOT EXISTS google_sub TEXT;

ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;

ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';

ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';

ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;

ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_token_hash TEXT;

ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_expires_at TIMESTAMPTZ;

ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_code_hash TEXT;

ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_code_expires_at TIMESTAMPTZ;

ALTER TABLE users ADD COLUMN IF NOT EXISTS last_verification_email_sent_at TIMESTAMPTZ;

ALTER TABLE users ADD COLUMN IF NOT EXISTS welcome_email_sent_at TIMESTAMPTZ;

ALTER TABLE users ADD COLUMN IF NOT EXISTS marketing_emails_enabled BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE users ADD COLUMN IF NOT EXISTS marketing_unsubscribed_at TIMESTAMPTZ;

ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token_hash TEXT;

ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_expires_at TIMESTAMPTZ;

ALTER TABLE users ADD COLUMN IF NOT EXISTS has_full_access BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE users ADD COLUMN IF NOT EXISTS partial_access JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE users ADD COLUMN IF NOT EXISTS current_level TEXT NOT NULL DEFAULT 'Not specified';

ALTER TABLE users ADD COLUMN IF NOT EXISTS target_level TEXT;

ALTER TABLE users ADD COLUMN IF NOT EXISTS level_updated_at TIMESTAMPTZ;

ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ;

UPDATE users SET role = 'user' WHERE role IS NULL OR role::text NOT IN ('user', 'admin');

UPDATE users SET status = 'active' WHERE status IS NULL OR status::text NOT IN ('active', 'suspended');

ALTER TABLE users ALTER COLUMN role DROP DEFAULT;

ALTER TABLE users ALTER COLUMN role TYPE user_role USING role::text::user_role;

ALTER TABLE users ALTER COLUMN role SET DEFAULT 'user';

ALTER TABLE users ALTER COLUMN status DROP DEFAULT;

ALTER TABLE users ALTER COLUMN status TYPE account_status USING status::text::account_status;

ALTER TABLE users ALTER COLUMN status SET DEFAULT 'active';

CREATE UNIQUE INDEX IF NOT EXISTS users_username_unique_idx
      ON users(username)
      WHERE username IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS users_google_sub_unique_idx
      ON users(google_sub)
      WHERE google_sub IS NOT NULL;

CREATE INDEX IF NOT EXISTS users_role_status_idx
      ON users(role, status);

CREATE INDEX IF NOT EXISTS users_verification_token_idx
      ON users(verification_token_hash)
      WHERE verification_token_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS users_verification_code_idx
      ON users(verification_code_hash)
      WHERE verification_code_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS users_reset_token_idx
      ON users(reset_token_hash)
      WHERE reset_token_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS simulations (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      exam_name TEXT NOT NULL,
      taken_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      score_pct INTEGER NOT NULL CHECK (score_pct >= 0 AND score_pct <= 100),
      level_current TEXT,
      level_target TEXT,
      ai_corrections JSONB NOT NULL DEFAULT '{}'::jsonb
    );

ALTER TABLE simulations ADD COLUMN IF NOT EXISTS result_details JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE simulations ADD COLUMN IF NOT EXISTS duration_seconds INTEGER;

ALTER TABLE simulations ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

UPDATE simulations SET created_at = taken_at WHERE created_at IS NULL;

CREATE INDEX IF NOT EXISTS simulations_user_taken_at_idx
      ON simulations(user_id, taken_at DESC);

CREATE INDEX IF NOT EXISTS simulations_user_created_at_idx
      ON simulations(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS subscription_plans (
      id SERIAL PRIMARY KEY,
      level TEXT NOT NULL CHECK (level IN ('B1', 'B2')),
      plan_key TEXT NOT NULL CHECK (plan_key IN ('starter', 'standard', 'intensif')),
      plan_name TEXT NOT NULL,
      duration_days INTEGER NOT NULL CHECK (duration_days > 0),
      price_eur NUMERIC(10,2) NOT NULL CHECK (price_eur >= 0),
      currency TEXT NOT NULL DEFAULT 'EUR',
      writing_simulator_attempts INTEGER NOT NULL CHECK (writing_simulator_attempts >= 0),
      certifications JSONB NOT NULL DEFAULT '[]'::jsonb,
      unlocked_sections JSONB NOT NULL DEFAULT '[]'::jsonb,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(level, plan_key)
    );

CREATE TABLE IF NOT EXISTS user_subscriptions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      plan_id INTEGER NOT NULL REFERENCES subscription_plans(id) ON DELETE RESTRICT,
      level TEXT NOT NULL CHECK (level IN ('B1', 'B2')),
      plan_key TEXT NOT NULL CHECK (plan_key IN ('starter', 'standard', 'intensif')),
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'expired', 'cancelled', 'failed')),
      starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL,
      payment_provider TEXT NOT NULL DEFAULT 'manual',
      payment_reference TEXT,
      selected_certifications JSONB NOT NULL DEFAULT '[]'::jsonb,
      amount_paid NUMERIC(10,2) NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'EUR',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

CREATE TABLE IF NOT EXISTS writing_simulator_usage (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      subscription_id INTEGER NOT NULL REFERENCES user_subscriptions(id) ON DELETE CASCADE,
      level TEXT NOT NULL CHECK (level IN ('B1', 'B2')),
      attempts_allowed INTEGER NOT NULL CHECK (attempts_allowed >= 0),
      attempts_used INTEGER NOT NULL DEFAULT 0 CHECK (attempts_used >= 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, subscription_id, level)
    );

CREATE TABLE IF NOT EXISTS payment_transactions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      plan_id INTEGER NOT NULL REFERENCES subscription_plans(id) ON DELETE RESTRICT,
      provider TEXT NOT NULL DEFAULT 'manual' CHECK (provider IN ('stripe', 'cinetpay', 'notchpay', 'notpay', 'manual')),
      provider_reference TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'active', 'expired', 'cancelled', 'failed', 'succeeded')),
      amount NUMERIC(10,2) NOT NULL CHECK (amount >= 0),
      currency TEXT NOT NULL DEFAULT 'EUR',
      selected_certifications JSONB NOT NULL DEFAULT '[]'::jsonb,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

ALTER TABLE user_subscriptions ADD COLUMN IF NOT EXISTS selected_certifications JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE payment_transactions ADD COLUMN IF NOT EXISTS selected_certifications JSONB NOT NULL DEFAULT '[]'::jsonb;

DO $$
    BEGIN
      ALTER TABLE payment_transactions DROP CONSTRAINT IF EXISTS payment_transactions_provider_check;
      ALTER TABLE payment_transactions
        ADD CONSTRAINT payment_transactions_provider_check
        CHECK (provider IN ('stripe', 'cinetpay', 'notchpay', 'notpay', 'manual'));
    END $$;

DO $$
    BEGIN
      ALTER TABLE payment_transactions DROP CONSTRAINT IF EXISTS payment_transactions_status_check;
      ALTER TABLE payment_transactions
        ADD CONSTRAINT payment_transactions_status_check
        CHECK (status IN ('pending', 'processing', 'active', 'expired', 'cancelled', 'failed', 'succeeded'));
    END $$;

ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS speaking_simulator_quota INTEGER NOT NULL DEFAULT 0;

ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS plan_category TEXT NOT NULL DEFAULT 'standard';

ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS access_months INTEGER;

ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS billed_months INTEGER;

ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE user_subscriptions ADD COLUMN IF NOT EXISTS speaking_simulator_quota_override INTEGER;

ALTER TABLE user_subscriptions ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;

ALTER TABLE user_subscriptions ADD COLUMN IF NOT EXISTS revoked_by INTEGER REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE user_subscriptions ADD COLUMN IF NOT EXISTS grant_reason TEXT;

CREATE TABLE IF NOT EXISTS industrial_subscription_offers (
      id SERIAL PRIMARY KEY,
      offer_key TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      duration_days INTEGER NOT NULL CHECK (duration_days > 0),
      access_months INTEGER NOT NULL CHECK (access_months > 0),
      billed_months INTEGER NOT NULL CHECK (billed_months > 0),
      price_eur NUMERIC(10,2) NOT NULL CHECK (price_eur >= 0),
      currency TEXT NOT NULL DEFAULT 'EUR',
      speaking_simulator_quota INTEGER NOT NULL CHECK (speaking_simulator_quota >= 0),
      certifications JSONB NOT NULL DEFAULT '["goethe","osd","telc","ecl"]'::jsonb,
      unlocked_sections JSONB NOT NULL DEFAULT '["read","listen","speak","write"]'::jsonb,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

CREATE TABLE IF NOT EXISTS subscription_admin_events (
      id SERIAL PRIMARY KEY,
      subscription_id INTEGER REFERENCES user_subscriptions(id) ON DELETE SET NULL,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      admin_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

CREATE INDEX IF NOT EXISTS user_subscriptions_user_level_status_idx
      ON user_subscriptions(user_id, level, status, expires_at DESC);

CREATE INDEX IF NOT EXISTS user_subscriptions_selected_certifications_idx
      ON user_subscriptions USING GIN (selected_certifications);

CREATE INDEX IF NOT EXISTS writing_simulator_usage_user_level_idx
      ON writing_simulator_usage(user_id, level);

CREATE INDEX IF NOT EXISTS payment_transactions_user_created_idx
      ON payment_transactions(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS payment_transactions_provider_reference_idx
      ON payment_transactions(provider, provider_reference);

CREATE UNIQUE INDEX IF NOT EXISTS user_subscriptions_payment_reference_unique_idx
      ON user_subscriptions(payment_provider, payment_reference)
      WHERE payment_reference IS NOT NULL;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS affiliate_settings (
      id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id = TRUE),
      default_partner_commission_percent NUMERIC(5,2) NOT NULL DEFAULT 10 CHECK (default_partner_commission_percent >= 0 AND default_partner_commission_percent <= 100),
      first_purchase_discount_percent NUMERIC(5,2) NOT NULL DEFAULT 5 CHECK (first_purchase_discount_percent >= 0 AND first_purchase_discount_percent <= 100),
      commission_scope TEXT NOT NULL DEFAULT 'first_successful_purchase' CHECK (commission_scope IN ('first_successful_purchase')),
      commission_hold_days INTEGER NOT NULL DEFAULT 14 CHECK (commission_hold_days >= 0),
      minimum_withdrawal_amount NUMERIC(12,2) NOT NULL DEFAULT 10000 CHECK (minimum_withdrawal_amount >= 0),
      default_currency TEXT NOT NULL DEFAULT 'XAF',
      attribution_cookie_days INTEGER NOT NULL DEFAULT 30 CHECK (attribution_cookie_days > 0),
      programme_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

INSERT INTO affiliate_settings (id) VALUES (TRUE) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS affiliate_partners (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      public_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending_review' CHECK (status IN ('active', 'suspended', 'pending_review')),
      commission_rate NUMERIC(5,2) NOT NULL DEFAULT 10 CHECK (commission_rate >= 0 AND commission_rate <= 100),
      payout_method TEXT CHECK (payout_method IN ('mtn', 'orange')),
      payout_destination TEXT,
      terms_accepted_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

ALTER TABLE affiliate_partners ALTER COLUMN status SET DEFAULT 'pending_review';

CREATE TABLE IF NOT EXISTS affiliate_codes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      partner_id UUID NOT NULL REFERENCES affiliate_partners(id) ON DELETE CASCADE,
      code TEXT NOT NULL,
      discount_percent NUMERIC(5,2) NOT NULL DEFAULT 5 CHECK (discount_percent >= 0 AND discount_percent <= 100),
      commission_percent NUMERIC(5,2) CHECK (commission_percent IS NULL OR (commission_percent >= 0 AND commission_percent <= 100)),
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

CREATE UNIQUE INDEX IF NOT EXISTS affiliate_codes_code_lower_unique ON affiliate_codes (LOWER(code));

CREATE INDEX IF NOT EXISTS affiliate_codes_partner_idx ON affiliate_codes(partner_id, is_active);

CREATE TABLE IF NOT EXISTS affiliate_referrals (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      partner_id UUID NOT NULL REFERENCES affiliate_partners(id) ON DELETE RESTRICT,
      affiliate_code_id UUID NOT NULL REFERENCES affiliate_codes(id) ON DELETE RESTRICT,
      referred_user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'registered' CHECK (status IN ('registered', 'converted', 'disqualified')),
      attributed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      converted_at TIMESTAMPTZ,
      disqualification_reason TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

CREATE INDEX IF NOT EXISTS affiliate_referrals_partner_status_idx ON affiliate_referrals(partner_id, status, attributed_at DESC);

CREATE TABLE IF NOT EXISTS affiliate_payouts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      partner_id UUID NOT NULL REFERENCES affiliate_partners(id) ON DELETE RESTRICT,
      amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
      currency TEXT NOT NULL DEFAULT 'XAF',
      payout_method TEXT NOT NULL CHECK (payout_method IN ('mtn', 'orange')),
      payout_destination TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'processing', 'paid', 'rejected')),
      transaction_reference TEXT,
      rejection_reason TEXT,
      requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      processed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

CREATE INDEX IF NOT EXISTS affiliate_payouts_partner_status_idx ON affiliate_payouts(partner_id, status, requested_at DESC);

CREATE TABLE IF NOT EXISTS affiliate_commissions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      partner_id UUID NOT NULL REFERENCES affiliate_partners(id) ON DELETE RESTRICT,
      referral_id UUID NOT NULL REFERENCES affiliate_referrals(id) ON DELETE RESTRICT,
      payment_id INTEGER NOT NULL REFERENCES payment_transactions(id) ON DELETE RESTRICT,
      base_amount NUMERIC(12,2) NOT NULL CHECK (base_amount >= 0),
      commission_rate NUMERIC(5,2) NOT NULL CHECK (commission_rate >= 0 AND commission_rate <= 100),
      commission_amount NUMERIC(12,2) NOT NULL CHECK (commission_amount >= 0),
      currency TEXT NOT NULL DEFAULT 'XAF',
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'available', 'paid', 'cancelled')),
      available_at TIMESTAMPTZ NOT NULL,
      cancellation_reason TEXT,
      payout_id UUID REFERENCES affiliate_payouts(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(payment_id)
    );

CREATE INDEX IF NOT EXISTS affiliate_commissions_partner_status_idx ON affiliate_commissions(partner_id, status, available_at DESC);

CREATE TABLE IF NOT EXISTS affiliate_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      partner_id UUID REFERENCES affiliate_partners(id) ON DELETE SET NULL,
      affiliate_code_id UUID REFERENCES affiliate_codes(id) ON DELETE SET NULL,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      event_type TEXT NOT NULL,
      ip_hash TEXT,
      user_agent_hash TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

CREATE INDEX IF NOT EXISTS affiliate_events_code_created_idx ON affiliate_events(affiliate_code_id, created_at DESC);

CREATE TABLE IF NOT EXISTS affiliate_admin_events (
      id SERIAL PRIMARY KEY,
      admin_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      partner_id UUID REFERENCES affiliate_partners(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

ALTER TABLE subscription_plans ENABLE ROW LEVEL SECURITY;

ALTER TABLE user_subscriptions ENABLE ROW LEVEL SECURITY;

ALTER TABLE writing_simulator_usage ENABLE ROW LEVEL SECURITY;

ALTER TABLE payment_transactions ENABLE ROW LEVEL SECURITY;

ALTER TABLE industrial_subscription_offers ENABLE ROW LEVEL SECURITY;

ALTER TABLE subscription_admin_events ENABLE ROW LEVEL SECURITY;

ALTER TABLE affiliate_settings ENABLE ROW LEVEL SECURITY;

ALTER TABLE affiliate_partners ENABLE ROW LEVEL SECURITY;

ALTER TABLE affiliate_codes ENABLE ROW LEVEL SECURITY;

ALTER TABLE affiliate_referrals ENABLE ROW LEVEL SECURITY;

ALTER TABLE affiliate_commissions ENABLE ROW LEVEL SECURITY;

ALTER TABLE affiliate_payouts ENABLE ROW LEVEL SECURITY;

ALTER TABLE affiliate_events ENABLE ROW LEVEL SECURITY;

ALTER TABLE affiliate_admin_events ENABLE ROW LEVEL SECURITY;

DO $$
    BEGIN
      CREATE POLICY subscription_plans_read_active
        ON subscription_plans
        FOR SELECT
        USING (is_active = TRUE);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;

CREATE TABLE IF NOT EXISTS refresh_tokens (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      revoked_at TIMESTAMPTZ,
      replaced_by_token_hash TEXT,
      user_agent TEXT,
      ip_address TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

CREATE INDEX IF NOT EXISTS refresh_tokens_user_active_idx
      ON refresh_tokens(user_id, expires_at DESC)
      WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS revoked_tokens (
      jti TEXT PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      revoked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

CREATE INDEX IF NOT EXISTS revoked_tokens_expires_idx
      ON revoked_tokens(expires_at);

CREATE TABLE IF NOT EXISTS api_usage_logs (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      method TEXT NOT NULL,
      path TEXT NOT NULL,
      status_code INTEGER NOT NULL,
      feature TEXT NOT NULL DEFAULT 'general',
      is_ai_usage BOOLEAN NOT NULL DEFAULT FALSE,
      units INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

CREATE INDEX IF NOT EXISTS api_usage_user_created_idx
      ON api_usage_logs(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS testimonials (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      display_name TEXT NOT NULL,
      role_label TEXT,
      rating INTEGER NOT NULL DEFAULT 5 CHECK (rating >= 1 AND rating <= 5),
      comment TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
      admin_note TEXT,
      reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      reviewed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

CREATE INDEX IF NOT EXISTS testimonials_status_created_idx ON testimonials(status, created_at DESC);

CREATE INDEX IF NOT EXISTS testimonials_user_created_idx ON testimonials(user_id, created_at DESC);

ALTER TABLE testimonials ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS email_events (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      email_type TEXT NOT NULL,
      recipient TEXT NOT NULL,
      subject TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT 'disabled',
      status TEXT NOT NULL DEFAULT 'logged',
      provider_message_id TEXT,
      error_message TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

ALTER TABLE email_events ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS email_events_user_created_idx
      ON email_events(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS email_events_type_status_idx
      ON email_events(email_type, status, created_at DESC);

CREATE TABLE IF NOT EXISTS admin_audit_logs (
      id SERIAL PRIMARY KEY,
      admin_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      target_type TEXT,
      target_id TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

CREATE INDEX IF NOT EXISTS admin_audit_created_idx
      ON admin_audit_logs(created_at DESC);

CREATE TABLE IF NOT EXISTS exams (
      id SERIAL PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      exam_type TEXT NOT NULL,
      level TEXT,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

CREATE TABLE IF NOT EXISTS exam_questions (
      id SERIAL PRIMARY KEY,
      exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
      module_id TEXT NOT NULL,
      prompt TEXT NOT NULL,
      options JSONB NOT NULL DEFAULT '[]'::jsonb,
      correct_answer JSONB NOT NULL DEFAULT '{}'::jsonb,
      explanation TEXT,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

CREATE INDEX IF NOT EXISTS exam_questions_exam_position_idx
      ON exam_questions(exam_id, position, id);

CREATE TABLE IF NOT EXISTS results (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      exam_type VARCHAR(50),
      score INTEGER,
      completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

CREATE INDEX IF NOT EXISTS results_user_completed_idx
      ON results(user_id, completed_at DESC);

CREATE TABLE IF NOT EXISTS copies_ecrites (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      prompt TEXT,
      response TEXT,
      ai_feedback TEXT,
      score INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

CREATE INDEX IF NOT EXISTS copies_ecrites_user_created_idx
      ON copies_ecrites(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS statistiques (
      id SERIAL PRIMARY KEY,
      total_users INTEGER,
      total_exams INTEGER,
      api_usage INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

CREATE TABLE IF NOT EXISTS logs (
      id SERIAL PRIMARY KEY,
      user_id INTEGER,
      action TEXT,
      ip_address TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

CREATE INDEX IF NOT EXISTS logs_user_created_idx
      ON logs(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS exam_content (
      id SERIAL PRIMARY KEY,
      type VARCHAR(50),
      level VARCHAR(10),
      language VARCHAR(10),
      question TEXT,
      answers JSONB NOT NULL DEFAULT '[]'::jsonb,
      correct_answer TEXT,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

CREATE INDEX IF NOT EXISTS exam_content_type_level_idx
      ON exam_content(type, level, created_at DESC);

-- document import schema (formerly runtime-initialized)
CREATE TABLE IF NOT EXISTS exam_document_imports (
      id SERIAL PRIMARY KEY,
      document_hash TEXT UNIQUE NOT NULL,
      filename TEXT NOT NULL,
      mime_type TEXT,
      size_bytes INTEGER,
      provider TEXT,
      exam_type TEXT,
      level TEXT,
      section_type TEXT,
      total_series INTEGER NOT NULL DEFAULT 0,
      total_sections INTEGER NOT NULL DEFAULT 0,
      total_questions INTEGER NOT NULL DEFAULT 0,
      extraction_method TEXT,
      parse_status TEXT NOT NULL DEFAULT 'imported',
      validation_warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
      raw_outline JSONB NOT NULL DEFAULT '{}'::jsonb,
      draft_content JSONB NOT NULL DEFAULT '{}'::jsonb,
      confidence JSONB NOT NULL DEFAULT '{}'::jsonb,
      imported_exam_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      error_message TEXT,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      published_at TIMESTAMPTZ
    );

ALTER TABLE exam_document_imports ADD COLUMN IF NOT EXISTS draft_content JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE exam_document_imports ADD COLUMN IF NOT EXISTS confidence JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE exam_document_imports ADD COLUMN IF NOT EXISTS error_message TEXT;

ALTER TABLE exam_document_imports ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE exam_document_imports ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS exam_document_imports_created_idx
      ON exam_document_imports(created_at DESC);

CREATE INDEX IF NOT EXISTS exam_document_imports_status_idx
      ON exam_document_imports(parse_status, updated_at DESC);

ALTER TABLE exam_document_imports ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS exam_import_preferences (
      id SERIAL PRIMARY KEY,
      provider TEXT,
      section_type TEXT,
      preference_type TEXT NOT NULL,
      source_key TEXT,
      value JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

CREATE INDEX IF NOT EXISTS exam_import_preferences_lookup_idx
      ON exam_import_preferences(provider, section_type, preference_type, updated_at DESC);

ALTER TABLE exam_import_preferences ENABLE ROW LEVEL SECURITY;

ALTER TABLE exams ADD COLUMN IF NOT EXISTS provider TEXT;

ALTER TABLE exams ADD COLUMN IF NOT EXISTS section_type TEXT;

ALTER TABLE exams ADD COLUMN IF NOT EXISTS series_number INTEGER;

ALTER TABLE exams ADD COLUMN IF NOT EXISTS source_import_id INTEGER;

ALTER TABLE exams ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS exams_source_import_idx
      ON exams(source_import_id);

CREATE TABLE IF NOT EXISTS exam_sections (
      id SERIAL PRIMARY KEY,
      exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
      section_type TEXT NOT NULL,
      part_number INTEGER NOT NULL DEFAULT 1,
      title TEXT NOT NULL,
      instructions TEXT,
      duration_minutes INTEGER,
      points NUMERIC(8,2),
      scoring JSONB NOT NULL DEFAULT '{}'::jsonb,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

CREATE INDEX IF NOT EXISTS exam_sections_exam_position_idx
      ON exam_sections(exam_id, position, id);

ALTER TABLE exam_sections ADD COLUMN IF NOT EXISTS points NUMERIC(8,2);

ALTER TABLE exam_sections ALTER COLUMN points TYPE NUMERIC(8,2) USING points::numeric;

ALTER TABLE exam_sections ENABLE ROW LEVEL SECURITY;

ALTER TABLE exam_questions ADD COLUMN IF NOT EXISTS section_id INTEGER REFERENCES exam_sections(id) ON DELETE SET NULL;

ALTER TABLE exam_questions ADD COLUMN IF NOT EXISTS question_type TEXT;

ALTER TABLE exam_questions ADD COLUMN IF NOT EXISTS transcript TEXT;

ALTER TABLE exam_questions ADD COLUMN IF NOT EXISTS audio JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE exam_questions ADD COLUMN IF NOT EXISTS scoring JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE exam_questions ADD COLUMN IF NOT EXISTS source_metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE exam_sections ADD COLUMN IF NOT EXISTS global_duration_minutes INTEGER;

ALTER TABLE exam_sections ADD COLUMN IF NOT EXISTS listening_count INTEGER;

ALTER TABLE exam_sections ADD COLUMN IF NOT EXISTS audio_generation_status TEXT NOT NULL DEFAULT 'draft';

ALTER TABLE exam_sections ADD COLUMN IF NOT EXISTS source_metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS exam_listening_audio_items (
      id SERIAL PRIMARY KEY,
      exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
      section_id INTEGER REFERENCES exam_sections(id) ON DELETE CASCADE,
      source_import_id INTEGER REFERENCES exam_document_imports(id) ON DELETE SET NULL,
      provider TEXT NOT NULL,
      level TEXT,
      series_number INTEGER,
      part_number INTEGER NOT NULL DEFAULT 1,
      item_number INTEGER NOT NULL DEFAULT 1,
      title TEXT NOT NULL,
      instructions TEXT,
      admin_transcript TEXT,
      audio_engine_settings JSONB NOT NULL DEFAULT '{}'::jsonb,
      listening_count INTEGER,
      duration_seconds NUMERIC(10,2),
      generated_audio_url TEXT,
      generated_audio_asset_id INTEGER,
      audio_generation_status TEXT NOT NULL DEFAULT 'draft'
        CHECK (audio_generation_status IN ('draft', 'queued', 'generating', 'generated', 'approved', 'published', 'failed')),
      validation_warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
      source_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      position INTEGER NOT NULL DEFAULT 0,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

ALTER TABLE exam_listening_audio_items ADD COLUMN IF NOT EXISTS source_import_id INTEGER REFERENCES exam_document_imports(id) ON DELETE SET NULL;

ALTER TABLE exam_listening_audio_items ADD COLUMN IF NOT EXISTS generated_audio_asset_id INTEGER;

ALTER TABLE exam_listening_audio_items ADD COLUMN IF NOT EXISTS validation_warnings JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE exam_listening_audio_items ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS exam_listening_audio_items_lookup_idx
      ON exam_listening_audio_items(exam_id, part_number, position, item_number);

CREATE INDEX IF NOT EXISTS exam_listening_audio_items_status_idx
      ON exam_listening_audio_items(audio_generation_status, updated_at DESC);

CREATE INDEX IF NOT EXISTS exam_listening_audio_items_import_idx
      ON exam_listening_audio_items(source_import_id);

-- catalog indexes (formerly runtime-initialized)
CREATE INDEX IF NOT EXISTS exams_published_catalog_idx
      ON exams (LOWER(provider), UPPER(level), series_number, section_type)
      WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS exam_sections_exam_part_position_idx
      ON exam_sections (exam_id, part_number, position, id);

CREATE INDEX IF NOT EXISTS exam_questions_exam_section_position_idx
      ON exam_questions (exam_id, section_id, position, id);

-- writing correction schema (formerly runtime-initialized)
CREATE TABLE IF NOT EXISTS writing_corrections (
      id SERIAL PRIMARY KEY,
      simulation_id INTEGER NOT NULL UNIQUE REFERENCES simulations(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'processing', 'completed', 'partial', 'failed')),
      provider TEXT NOT NULL DEFAULT 'gemini',
      model TEXT,
      total_score NUMERIC(8,2) NOT NULL DEFAULT 0,
      max_score NUMERIC(8,2) NOT NULL DEFAULT 0,
      percentage INTEGER,
      overall_feedback TEXT,
      overall_strengths JSONB NOT NULL DEFAULT '[]'::jsonb,
      overall_weaknesses JSONB NOT NULL DEFAULT '[]'::jsonb,
      error_message TEXT,
      request_hash TEXT,
      task_count INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      corrected_at TIMESTAMPTZ
    );

CREATE INDEX IF NOT EXISTS writing_corrections_user_created_idx
      ON writing_corrections(user_id, created_at DESC);

ALTER TABLE writing_corrections ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS writing_correction_tasks (
      id SERIAL PRIMARY KEY,
      correction_id INTEGER NOT NULL REFERENCES writing_corrections(id) ON DELETE CASCADE,
      simulation_id INTEGER NOT NULL REFERENCES simulations(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      task_index INTEGER NOT NULL,
      task_id TEXT,
      title TEXT,
      instructions TEXT,
      subtitles JSONB NOT NULL DEFAULT '[]'::jsonb,
      exam_type TEXT,
      module_type TEXT,
      duration_minutes INTEGER,
      task_weight NUMERIC(8,2),
      response_text TEXT,
      validation_status TEXT NOT NULL DEFAULT 'valid',
      is_on_topic BOOLEAN NOT NULL DEFAULT TRUE,
      is_meaningful BOOLEAN NOT NULL DEFAULT TRUE,
      should_show_improvement BOOLEAN NOT NULL DEFAULT FALSE,
      main_message TEXT,
      sentence_corrections JSONB NOT NULL DEFAULT '[]'::jsonb,
      improved_version TEXT,
      next_steps JSONB NOT NULL DEFAULT '[]'::jsonb,
      score_percentage NUMERIC(8,2) NOT NULL DEFAULT 0,
      score NUMERIC(8,2) NOT NULL DEFAULT 0,
      max_score NUMERIC(8,2) NOT NULL DEFAULT 0,
      criterion_scores JSONB NOT NULL DEFAULT '{}'::jsonb,
      strengths JSONB NOT NULL DEFAULT '[]'::jsonb,
      weaknesses JSONB NOT NULL DEFAULT '[]'::jsonb,
      feedback TEXT,
      estimated_level TEXT,
      model TEXT,
      request_hash TEXT,
      corrected_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (simulation_id, task_index)
    );

CREATE INDEX IF NOT EXISTS writing_correction_tasks_correction_idx
      ON writing_correction_tasks(correction_id, task_index);

ALTER TABLE writing_correction_tasks ADD COLUMN IF NOT EXISTS validation_status TEXT NOT NULL DEFAULT 'valid';

ALTER TABLE writing_correction_tasks ADD COLUMN IF NOT EXISTS is_on_topic BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE writing_correction_tasks ADD COLUMN IF NOT EXISTS is_meaningful BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE writing_correction_tasks ADD COLUMN IF NOT EXISTS should_show_improvement BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE writing_correction_tasks ADD COLUMN IF NOT EXISTS main_message TEXT;

ALTER TABLE writing_correction_tasks ADD COLUMN IF NOT EXISTS sentence_corrections JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE writing_correction_tasks ADD COLUMN IF NOT EXISTS improved_version TEXT;

ALTER TABLE writing_correction_tasks ADD COLUMN IF NOT EXISTS next_steps JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE writing_correction_tasks ADD COLUMN IF NOT EXISTS score_percentage NUMERIC(8,2) NOT NULL DEFAULT 0;

ALTER TABLE writing_correction_tasks ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS ai_correction_logs (
      id SERIAL PRIMARY KEY,
      correction_id INTEGER REFERENCES writing_corrections(id) ON DELETE SET NULL,
      simulation_id INTEGER REFERENCES simulations(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      task_index INTEGER,
      provider TEXT NOT NULL DEFAULT 'gemini',
      model TEXT,
      request_hash TEXT,
      status TEXT NOT NULL DEFAULT 'started',
      attempt_count INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      request_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      response_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ
    );

CREATE INDEX IF NOT EXISTS ai_correction_logs_simulation_created_idx
      ON ai_correction_logs(simulation_id, created_at DESC);

ALTER TABLE ai_correction_logs ENABLE ROW LEVEL SECURITY;

-- speaking correction schema (formerly runtime-initialized)
CREATE TABLE IF NOT EXISTS speaking_provider_profiles (
      id SERIAL PRIMARY KEY,
      profile_key TEXT UNIQUE NOT NULL,
      provider TEXT NOT NULL,
      level TEXT NOT NULL,
      version TEXT NOT NULL,
      profile JSONB NOT NULL DEFAULT '{}'::jsonb,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

CREATE TABLE IF NOT EXISTS speaking_content_packs (
      id SERIAL PRIMARY KEY,
      pack_key TEXT UNIQUE NOT NULL,
      provider TEXT NOT NULL,
      level TEXT NOT NULL,
      package_version TEXT NOT NULL,
      manifest JSONB NOT NULL DEFAULT '{}'::jsonb,
      imported_exam_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      import_report JSONB NOT NULL DEFAULT '{}'::jsonb,
      status TEXT NOT NULL DEFAULT 'draft',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

CREATE TABLE IF NOT EXISTS speaking_recordings (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      simulation_id INTEGER REFERENCES simulations(id) ON DELETE SET NULL,
      source_exam_id INTEGER REFERENCES exams(id) ON DELETE SET NULL,
      source_question_id INTEGER REFERENCES exam_questions(id) ON DELETE SET NULL,
      task_id TEXT,
      mime_type TEXT NOT NULL,
      byte_size INTEGER NOT NULL DEFAULT 0,
      duration_seconds INTEGER,
      audio_sha256 TEXT NOT NULL,
      audio_data BYTEA NOT NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      status TEXT NOT NULL DEFAULT 'uploaded',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

CREATE TABLE IF NOT EXISTS speaking_evaluations (
      id SERIAL PRIMARY KEY,
      simulation_id INTEGER UNIQUE REFERENCES simulations(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'processing',
      provider_result JSONB NOT NULL DEFAULT '{}'::jsonb,
      diagnostics JSONB NOT NULL DEFAULT '{}'::jsonb,
      evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
      feedback JSONB NOT NULL DEFAULT '{}'::jsonb,
      quality JSONB NOT NULL DEFAULT '{}'::jsonb,
      provenance JSONB NOT NULL DEFAULT '{}'::jsonb,
      error_message TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

CREATE INDEX IF NOT EXISTS speaking_recordings_user_created_idx ON speaking_recordings(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS speaking_recordings_question_idx ON speaking_recordings(source_question_id, user_id);

CREATE INDEX IF NOT EXISTS speaking_evaluations_user_created_idx ON speaking_evaluations(user_id, created_at DESC);

ALTER TABLE speaking_provider_profiles ENABLE ROW LEVEL SECURITY;

ALTER TABLE speaking_content_packs ENABLE ROW LEVEL SECURITY;

ALTER TABLE speaking_recordings ENABLE ROW LEVEL SECURITY;

ALTER TABLE speaking_evaluations ENABLE ROW LEVEL SECURITY;

-- content style schema (formerly runtime-initialized)
CREATE TABLE IF NOT EXISTS content_style_templates (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      block_type TEXT NOT NULL,
      style_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

ALTER TABLE content_style_templates ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS content_style_templates_active_idx
      ON content_style_templates(block_type, is_active, updated_at DESC);

-- voice profile schema (formerly runtime-initialized)
CREATE TABLE IF NOT EXISTS tts_voice_profiles (
        id SERIAL PRIMARY KEY,
        profile_key TEXT NOT NULL UNIQUE,
        label TEXT NOT NULL,
        provider TEXT NOT NULL DEFAULT 'elevenlabs',
        voice_id TEXT,
        gender TEXT NOT NULL CHECK (gender IN ('female', 'male', 'neutral')),
        role TEXT NOT NULL DEFAULT 'speaker',
        style TEXT,
        settings JSONB NOT NULL DEFAULT '{}'::jsonb,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

ALTER TABLE tts_voice_profiles ENABLE ROW LEVEL SECURITY;

DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
          REVOKE ALL ON TABLE tts_voice_profiles FROM anon;
        END IF;
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
          REVOKE ALL ON TABLE tts_voice_profiles FROM authenticated;
        END IF;
      END $$;

INSERT INTO tts_voice_profiles (profile_key, label, provider, voice_id, gender, role, style, settings)
      VALUES
        ('de_female_1', 'Deutsch weiblich 1', 'elevenlabs', 'Xb7hH8MSUJpSbSDYk0k2', 'female', 'speaker', 'klar, freundlich', '{"stability":0.62,"similarity":0.78}'::jsonb),
        ('de_female_2', 'Deutsch weiblich 2', 'elevenlabs', 'XrExE9yKIg1WjnnlVkGX', 'female', 'speaker', 'natuerlich, ruhig', '{"stability":0.58,"similarity":0.76}'::jsonb),
        ('de_female_3', 'Deutsch weiblich 3', 'elevenlabs', 'pFZP5JQG7iQjIQuC4Bku', 'female', 'speaker', 'warm, professionell', '{"stability":0.60,"similarity":0.77}'::jsonb),
        ('de_male_1', 'Deutsch maennlich 1', 'elevenlabs', 'onwK4e9ZLuTAKqWW03F9', 'male', 'speaker', 'klar, neutral', '{"stability":0.62,"similarity":0.78}'::jsonb),
        ('de_male_2', 'Deutsch maennlich 2', 'elevenlabs', 'iP95p4xoKVk53GoZ742B', 'male', 'speaker', 'natuerlich, warm', '{"stability":0.58,"similarity":0.76}'::jsonb),
        ('de_male_3', 'Deutsch maennlich 3', 'elevenlabs', 'cjVigY5qzO86Huf0OWal', 'male', 'speaker', 'ruhig, vertrauenswuerdig', '{"stability":0.60,"similarity":0.77}'::jsonb)
      ON CONFLICT (profile_key) DO UPDATE SET
        label = EXCLUDED.label,
        provider = EXCLUDED.provider,
        voice_id = EXCLUDED.voice_id,
        gender = EXCLUDED.gender,
        role = EXCLUDED.role,
        style = EXCLUDED.style,
        settings = tts_voice_profiles.settings || EXCLUDED.settings,
        updated_at = NOW();

CREATE INDEX IF NOT EXISTS tts_voice_profiles_active_idx ON tts_voice_profiles(provider, gender, is_active);

-- audio asset schema (formerly runtime-initialized)
CREATE TABLE IF NOT EXISTS exam_audio_assets (
      id SERIAL PRIMARY KEY,
      source_exam_id INTEGER REFERENCES exams(id) ON DELETE CASCADE,
      content_hash TEXT NOT NULL UNIQUE,
      provider TEXT NOT NULL,
      provider_model TEXT,
      voice_summary JSONB NOT NULL DEFAULT '[]'::jsonb,
      audio_config JSONB NOT NULL DEFAULT '{}'::jsonb,
      mime_type TEXT NOT NULL DEFAULT 'audio/mpeg',
      audio_data BYTEA,
      byte_size INTEGER NOT NULL DEFAULT 0,
      duration_seconds INTEGER,
      status TEXT NOT NULL DEFAULT 'ready',
      error_message TEXT,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

ALTER TABLE exam_audio_assets ENABLE ROW LEVEL SECURITY;

DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        REVOKE ALL ON TABLE exam_audio_assets FROM anon;
      END IF;
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        REVOKE ALL ON TABLE exam_audio_assets FROM authenticated;
      END IF;
    END $$;

CREATE INDEX IF NOT EXISTS exam_audio_assets_exam_idx ON exam_audio_assets(source_exam_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS exam_audio_assets_status_idx ON exam_audio_assets(status, updated_at DESC);

-- listening audio production schema (formerly runtime-initialized)
ALTER TABLE exam_listening_audio_items
      ADD COLUMN IF NOT EXISTS voice_profile_map JSONB NOT NULL DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS admin_notes TEXT,
      ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS generation_log JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS exam_listening_audio_items_exam_status_idx ON exam_listening_audio_items(exam_id, audio_generation_status, part_number, item_number);

CREATE UNIQUE INDEX IF NOT EXISTS exam_listening_audio_items_exam_part_item_uidx ON exam_listening_audio_items(exam_id, part_number, item_number);

-- The browser never connects to these tables directly. Keep every public table
-- protected by RLS and let the server-side database role perform application IO.
DO $$
DECLARE
  protected_table text;
BEGIN
  FOREACH protected_table IN ARRAY ARRAY[
    'users', 'simulations', 'subscription_plans', 'user_subscriptions',
    'writing_simulator_usage', 'payment_transactions',
    'industrial_subscription_offers', 'subscription_admin_events',
    'affiliate_settings', 'affiliate_partners', 'affiliate_codes',
    'affiliate_referrals', 'affiliate_payouts', 'affiliate_commissions',
    'affiliate_events', 'affiliate_admin_events', 'refresh_tokens',
    'revoked_tokens', 'api_usage_logs', 'testimonials', 'email_events',
    'admin_audit_logs', 'exams', 'exam_questions', 'results',
    'copies_ecrites', 'statistiques', 'logs', 'exam_content',
    'exam_document_imports', 'exam_import_preferences', 'exam_sections',
    'exam_listening_audio_items', 'tts_voice_profiles', 'exam_audio_assets',
    'writing_corrections', 'writing_correction_tasks', 'ai_correction_logs',
    'speaking_provider_profiles', 'speaking_content_packs',
    'speaking_recordings', 'speaking_evaluations', 'content_style_templates'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', protected_table);
  END LOOP;
END
$$;

-- Reference data formerly upserted during every serverless cold start.
INSERT INTO subscription_plans (
  level, plan_key, plan_name, duration_days, price_eur, currency,
  writing_simulator_attempts, speaking_simulator_quota, certifications,
  unlocked_sections, plan_category, access_months, billed_months, metadata,
  is_active, updated_at
)
VALUES
  ('B1', 'starter',  'Starter',  5, 14.99, 'EUR',  3, 20, '["goethe","osd","telc","ecl"]'::jsonb, '["read","listen","speak","write"]'::jsonb, 'standard', NULL, NULL, '{"speakingSimulatorQuota":20}'::jsonb, TRUE, NOW()),
  ('B1', 'standard', 'Standard', 15, 29.99, 'EUR',  6, 45, '["goethe","osd","telc","ecl"]'::jsonb, '["read","listen","speak","write"]'::jsonb, 'standard', NULL, NULL, '{"speakingSimulatorQuota":45}'::jsonb, TRUE, NOW()),
  ('B1', 'intensif', 'Intensif', 30, 54.99, 'EUR', 10, 65, '["goethe","osd","telc","ecl"]'::jsonb, '["read","listen","speak","write"]'::jsonb, 'standard', NULL, NULL, '{"speakingSimulatorQuota":65}'::jsonb, TRUE, NOW()),
  ('B2', 'starter',  'Starter',  5, 19.99, 'EUR',  3, 20, '["goethe","osd","telc","ecl"]'::jsonb, '["read","listen","speak","write"]'::jsonb, 'standard', NULL, NULL, '{"speakingSimulatorQuota":20}'::jsonb, TRUE, NOW()),
  ('B2', 'standard', 'Standard', 15, 34.99, 'EUR',  6, 45, '["goethe","osd","telc","ecl"]'::jsonb, '["read","listen","speak","write"]'::jsonb, 'standard', NULL, NULL, '{"speakingSimulatorQuota":45}'::jsonb, TRUE, NOW()),
  ('B2', 'intensif', 'Intensif', 30, 64.99, 'EUR', 10, 65, '["goethe","osd","telc","ecl"]'::jsonb, '["read","listen","speak","write"]'::jsonb, 'standard', NULL, NULL, '{"speakingSimulatorQuota":65}'::jsonb, TRUE, NOW())
ON CONFLICT (level, plan_key) DO UPDATE SET
  plan_name = EXCLUDED.plan_name,
  duration_days = EXCLUDED.duration_days,
  price_eur = EXCLUDED.price_eur,
  currency = EXCLUDED.currency,
  writing_simulator_attempts = EXCLUDED.writing_simulator_attempts,
  speaking_simulator_quota = EXCLUDED.speaking_simulator_quota,
  certifications = EXCLUDED.certifications,
  unlocked_sections = EXCLUDED.unlocked_sections,
  plan_category = EXCLUDED.plan_category,
  access_months = EXCLUDED.access_months,
  billed_months = EXCLUDED.billed_months,
  metadata = EXCLUDED.metadata,
  is_active = TRUE,
  updated_at = NOW();

INSERT INTO industrial_subscription_offers (
  offer_key, label, duration_days, access_months, billed_months, price_eur,
  speaking_simulator_quota, certifications, unlocked_sections, is_active, updated_at
)
VALUES
  ('industrial_1_month', 'Industrial 1 month', 30, 1, 1, 450.99, 240, '["goethe","osd","telc","ecl"]'::jsonb, '["read","listen","speak","write"]'::jsonb, TRUE, NOW()),
  ('industrial_6_months', 'Industrial 6 months', 180, 6, 6, 2500.99, 600, '["goethe","osd","telc","ecl"]'::jsonb, '["read","listen","speak","write"]'::jsonb, TRUE, NOW()),
  ('industrial_12_plus_2', 'Industrial 1 year + 2 free months', 420, 14, 12, 5000.99, 1000, '["goethe","osd","telc","ecl"]'::jsonb, '["read","listen","speak","write"]'::jsonb, TRUE, NOW())
ON CONFLICT (offer_key) DO UPDATE SET
  label = EXCLUDED.label,
  duration_days = EXCLUDED.duration_days,
  access_months = EXCLUDED.access_months,
  billed_months = EXCLUDED.billed_months,
  price_eur = EXCLUDED.price_eur,
  speaking_simulator_quota = EXCLUDED.speaking_simulator_quota,
  certifications = EXCLUDED.certifications,
  unlocked_sections = EXCLUDED.unlocked_sections,
  is_active = TRUE,
  updated_at = NOW();

COMMIT;
