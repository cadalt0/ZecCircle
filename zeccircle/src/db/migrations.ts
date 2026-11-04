/**
 * Ordered Postgres schema migrations. Each entry runs once and is recorded in schema_migrations.
 * Never edit a migration that has shipped: append a new one.
 *
 * Conventions: ids and Telegram ids are BIGINT (Telegram ids exceed 32 bits); money is integer minor
 * units (BIGINT); ZEC is integer zatoshis (BIGINT); timestamps are TIMESTAMPTZ (the driver returns
 * them as ISO strings); booleans are 0/1 INTEGERs.
 */
export const migrations: readonly string[] = [
  /* 1: initial schema */ `
  CREATE TABLE circles (
    id                    BIGSERIAL PRIMARY KEY,
    name                  TEXT        NOT NULL,
    owner_telegram_id     BIGINT      NOT NULL,
    currency              TEXT        NOT NULL,
    monthly_limit_minor   BIGINT      NOT NULL CHECK (monthly_limit_minor >= 0),
    default_per_purchase_limit_minor   BIGINT NOT NULL CHECK (default_per_purchase_limit_minor >= 0),
    default_member_monthly_limit_minor BIGINT NOT NULL CHECK (default_member_monthly_limit_minor >= 0),
    paused                INTEGER     NOT NULL DEFAULT 0 CHECK (paused IN (0, 1)),
    created_at            TIMESTAMPTZ NOT NULL
  );

  CREATE TABLE members (
    id                    BIGSERIAL PRIMARY KEY,
    circle_id             BIGINT      NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
    telegram_id           BIGINT      NOT NULL,
    display_name          TEXT        NOT NULL,
    role                  TEXT        NOT NULL CHECK (role IN ('owner', 'member')),
    status                TEXT        NOT NULL CHECK (status IN ('active', 'paused', 'removed')),
    per_purchase_limit_minor BIGINT   NOT NULL CHECK (per_purchase_limit_minor >= 0),
    monthly_limit_minor   BIGINT      NOT NULL CHECK (monthly_limit_minor >= 0),
    created_at            TIMESTAMPTZ NOT NULL,
    updated_at            TIMESTAMPTZ NOT NULL
  );
  CREATE INDEX idx_members_circle ON members(circle_id);
  -- A Telegram user can be in at most one circle at a time (active or paused).
  CREATE UNIQUE INDEX idx_members_one_live_membership
    ON members(telegram_id) WHERE status <> 'removed';

  CREATE TABLE invites (
    token                 TEXT        PRIMARY KEY,
    circle_id             BIGINT      NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
    created_by_telegram_id BIGINT     NOT NULL,
    expires_at            TIMESTAMPTZ NOT NULL,
    max_uses              INTEGER     NOT NULL CHECK (max_uses >= 1),
    use_count             INTEGER     NOT NULL DEFAULT 0 CHECK (use_count >= 0 AND use_count <= max_uses),
    revoked               INTEGER     NOT NULL DEFAULT 0 CHECK (revoked IN (0, 1)),
    created_at            TIMESTAMPTZ NOT NULL
  );
  CREATE INDEX idx_invites_circle ON invites(circle_id);

  CREATE TABLE purchases (
    id                    BIGSERIAL PRIMARY KEY,
    circle_id             BIGINT      NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
    member_id             BIGINT      NOT NULL REFERENCES members(id),
    product_id            TEXT        NOT NULL,
    product_name          TEXT        NOT NULL,
    package_id            TEXT,
    value                 TEXT        NOT NULL,
    phone_number          TEXT,
    quoted_minor          BIGINT      NOT NULL CHECK (quoted_minor > 0),
    paid_minor            BIGINT,
    currency              TEXT        NOT NULL,
    status                TEXT        NOT NULL CHECK (status IN (
                            'proposed', 'awaiting_approval', 'executing',
                            'completed', 'rejected', 'cancelled', 'failed', 'expired')),
    approved_by_telegram_id BIGINT,
    invoice_id            TEXT,
    failure_reason        TEXT,
    created_at            TIMESTAMPTZ NOT NULL,
    updated_at            TIMESTAMPTZ NOT NULL
  );
  CREATE INDEX idx_purchases_member_month ON purchases(member_id, created_at);
  CREATE INDEX idx_purchases_circle_month ON purchases(circle_id, created_at);
  CREATE INDEX idx_purchases_status ON purchases(status);

  CREATE TABLE audit_log (
    id                    BIGSERIAL PRIMARY KEY,
    circle_id             BIGINT,
    actor_telegram_id     BIGINT,
    action                TEXT        NOT NULL,
    details               TEXT,
    created_at            TIMESTAMPTZ NOT NULL
  );
  CREATE INDEX idx_audit_circle ON audit_log(circle_id, created_at);
  `,

  /* 2: Zcash funding (shielded deposits in), payments (purchases out), wallet seed */ `
  -- A /fund request. Its code goes in the payment memo: a backup way to match a deposit to a circle.
  CREATE TABLE zec_funding_requests (
    code                  TEXT        PRIMARY KEY,
    circle_id             BIGINT      NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
    requested_by_telegram_id BIGINT   NOT NULL,
    created_at            TIMESTAMPTZ NOT NULL
  );
  CREATE INDEX idx_zec_funding_circle ON zec_funding_requests(circle_id);

  -- One shielded deposit address per circle: anything paid to it belongs to that circle.
  CREATE TABLE zec_circle_addresses (
    circle_id             BIGINT      PRIMARY KEY REFERENCES circles(id) ON DELETE CASCADE,
    address               TEXT        NOT NULL UNIQUE,
    created_at            TIMESTAMPTZ NOT NULL
  );

  CREATE TABLE zec_deposits (
    id                    BIGSERIAL PRIMARY KEY,
    txid                  TEXT        NOT NULL,
    output_pool           INTEGER     NOT NULL,
    output_index          INTEGER     NOT NULL,
    amount_zat            BIGINT      NOT NULL CHECK (amount_zat > 0),
    memo                  TEXT,
    funding_code          TEXT REFERENCES zec_funding_requests(code),
    circle_id             BIGINT REFERENCES circles(id) ON DELETE SET NULL,
    mined_height          BIGINT,
    status                TEXT        NOT NULL CHECK (status IN ('seen', 'confirmed')),
    created_at            TIMESTAMPTZ NOT NULL,
    confirmed_at          TIMESTAMPTZ,
    UNIQUE (txid, output_pool, output_index)
  );
  CREATE INDEX idx_zec_deposits_circle ON zec_deposits(circle_id, status);

  CREATE TABLE zec_payments (
    id                    BIGSERIAL PRIMARY KEY,
    purchase_id           BIGINT      NOT NULL UNIQUE REFERENCES purchases(id),
    circle_id             BIGINT      NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
    amount_zat            BIGINT      NOT NULL CHECK (amount_zat > 0),
    price_minor_per_zec   BIGINT      NOT NULL CHECK (price_minor_per_zec > 0),
    to_address            TEXT        NOT NULL,
    status                TEXT        NOT NULL CHECK (status IN ('reserved', 'sending', 'sent', 'released', 'failed')),
    txid                  TEXT,
    error                 TEXT,
    created_at            TIMESTAMPTZ NOT NULL,
    updated_at            TIMESTAMPTZ NOT NULL
  );
  CREATE INDEX idx_zec_payments_circle ON zec_payments(circle_id, status);

  -- TESTNET ONLY: the bot wallet's seed phrase, so the wallet can be rebuilt on hosts with a
  -- throwaway disk (Heroku). Do not do this with real funds.
  CREATE TABLE wallet_seed (
    network               TEXT        PRIMARY KEY,
    mnemonic              TEXT        NOT NULL,
    birthday_height       BIGINT      NOT NULL,
    created_at            TIMESTAMPTZ NOT NULL
  );
  `,

  /* 3: real-money tracking. A purchase is "live" when Bitrefill fulfils it for real; paid_at is set the
        moment Bitrefill confirms payment. The hard $5 ceiling counts live money that is committed or spent. */ `
  ALTER TABLE purchases ADD COLUMN fulfilment_mode TEXT NOT NULL DEFAULT 'mock'
    CHECK (fulfilment_mode IN ('mock', 'live'));
  ALTER TABLE purchases ADD COLUMN paid_at TIMESTAMPTZ;
  CREATE INDEX idx_purchases_live ON purchases(fulfilment_mode) WHERE fulfilment_mode = 'live';
  `,

  /* 4: mainnet ZEC -> USDC swaps (every step recorded before the next, so nothing is ever sent twice)
        and the Telegram chats that receive the developer activity log. */ `
  CREATE TABLE zec_swaps (
    id                    BIGSERIAL PRIMARY KEY,
    purchase_id           BIGINT      NOT NULL UNIQUE REFERENCES purchases(id),
    circle_id             BIGINT      NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
    status                TEXT        NOT NULL CHECK (status IN (
                            'invoice_created', 'quoted', 'deposit_sent', 'swap_succeeded', 'credited', 'refunded', 'failed')),
    bitrefill_invoice_id  TEXT        NOT NULL,
    pay_to_address        TEXT        NOT NULL,
    usdc_base_units       BIGINT      NOT NULL CHECK (usdc_base_units > 0),
    deposit_address       TEXT,
    amount_in_zat         BIGINT,
    quote_deadline        TIMESTAMPTZ,
    quote_json            TEXT,
    deposit_txid          TEXT,
    last_swap_status      TEXT,
    error                 TEXT,
    created_at            TIMESTAMPTZ NOT NULL,
    updated_at            TIMESTAMPTZ NOT NULL
  );
  CREATE INDEX idx_zec_swaps_status ON zec_swaps(status);

  CREATE TABLE log_channels (
    chat_id               BIGINT      PRIMARY KEY,
    title                 TEXT,
    added_by_telegram_id  BIGINT,
    created_at            TIMESTAMPTZ NOT NULL
  );
  `,

  /* 5: log channels are per circle: a circle's owner registers a chat for that circle's activity only.
        circle_id NULL = the developer feed of every circle (bot admins only). The table was brand new and
        empty in migration 4, so it is simply rebuilt. */ `
  DROP TABLE IF EXISTS log_channels;
  CREATE TABLE log_channels (
    id                    BIGSERIAL PRIMARY KEY,
    chat_id               BIGINT      NOT NULL,
    circle_id             BIGINT      REFERENCES circles(id) ON DELETE CASCADE,
    title                 TEXT,
    added_by_telegram_id  BIGINT,
    created_at            TIMESTAMPTZ NOT NULL
  );
  CREATE UNIQUE INDEX idx_log_channels_scope ON log_channels (chat_id, COALESCE(circle_id, 0));
  `,

  /* 6: Zcash records belong to a network (test / main / mock). Without this, switching the bot to mainnet
        would reuse a circle's TESTNET deposit address and count its TESTNET balance as real ZEC.
        Everything that exists before this migration is testnet or mock, so it is tagged 'test'. */ `
  ALTER TABLE zec_circle_addresses ADD COLUMN network TEXT NOT NULL DEFAULT 'test' CHECK (network IN ('main', 'test', 'mock'));
  ALTER TABLE zec_circle_addresses DROP CONSTRAINT zec_circle_addresses_pkey;
  ALTER TABLE zec_circle_addresses ADD PRIMARY KEY (circle_id, network);
  ALTER TABLE zec_deposits ADD COLUMN network TEXT NOT NULL DEFAULT 'test' CHECK (network IN ('main', 'test', 'mock'));
  ALTER TABLE zec_payments ADD COLUMN network TEXT NOT NULL DEFAULT 'test' CHECK (network IN ('main', 'test', 'mock'));
  CREATE INDEX idx_zec_deposits_network ON zec_deposits(circle_id, network, status);
  CREATE INDEX idx_zec_payments_network ON zec_payments(circle_id, network, status);
  `,
];
