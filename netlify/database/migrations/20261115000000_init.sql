CREATE TABLE IF NOT EXISTS categories (
  id text PRIMARY KEY NOT NULL,
  name text NOT NULL,
  sort integer DEFAULT 0 NOT NULL,
  active integer DEFAULT 1 NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id text PRIMARY KEY NOT NULL,
  category_id text NOT NULL,
  name text NOT NULL,
  description text DEFAULT '' NOT NULL,
  price double precision NOT NULL,
  image text DEFAULT '' NOT NULL,
  available integer DEFAULT 1 NOT NULL,
  featured integer DEFAULT 0 NOT NULL,
  customization integer DEFAULT 0 NOT NULL,
  custom_options text DEFAULT '[]' NOT NULL,
  track_stock integer DEFAULT 0 NOT NULL,
  stock_qty integer DEFAULT 0 NOT NULL,
  stock_unit text DEFAULT 'each' NOT NULL,
  low_threshold integer DEFAULT 0 NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id text PRIMARY KEY NOT NULL,
  number text NOT NULL,
  created_at text NOT NULL,
  items text NOT NULL,
  total double precision NOT NULL,
  method text NOT NULL,
  details text NOT NULL,
  payment_method text NOT NULL,
  paid integer DEFAULT 0 NOT NULL,
  status text DEFAULT 'new' NOT NULL,
  loyalty_card_id text,
  reward_product_id text,
  reward_applied integer DEFAULT 0 NOT NULL,
  reward_points integer DEFAULT 0 NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key text PRIMARY KEY NOT NULL,
  value text NOT NULL
);

CREATE TABLE IF NOT EXISTS staff (
  id text PRIMARY KEY NOT NULL,
  username text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role text NOT NULL,
  permissions text NOT NULL,
  active integer DEFAULT 1 NOT NULL
);

CREATE TABLE IF NOT EXISTS login_attempts (
  id serial PRIMARY KEY,
  ip_hash text NOT NULL,
  attempted_at bigint NOT NULL,
  succeeded integer DEFAULT 0 NOT NULL
);

CREATE TABLE IF NOT EXISTS attendance (
  id text PRIMARY KEY NOT NULL,
  username text NOT NULL,
  clock_in text NOT NULL,
  clock_out text
);
CREATE UNIQUE INDEX IF NOT EXISTS attendance_one_active ON attendance (username) WHERE clock_out IS NULL;

CREATE TABLE IF NOT EXISTS schedules (
  id text PRIMARY KEY NOT NULL,
  username text NOT NULL,
  shift_date text NOT NULL,
  start_time text NOT NULL,
  end_time text NOT NULL,
  note text DEFAULT '' NOT NULL
);

CREATE TABLE IF NOT EXISTS loyalty_cards (
  id text PRIMARY KEY NOT NULL,
  code_hash text NOT NULL UNIQUE,
  suffix text NOT NULL,
  points integer DEFAULT 0 NOT NULL,
  active integer DEFAULT 1 NOT NULL,
  created_at text NOT NULL
);

CREATE TABLE IF NOT EXISTS loyalty_events (
  id text PRIMARY KEY NOT NULL,
  card_id text NOT NULL,
  order_id text,
  kind text NOT NULL,
  amount integer NOT NULL,
  reason text DEFAULT '' NOT NULL,
  actor text DEFAULT 'system' NOT NULL,
  created_at text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS loyalty_card_order_kind ON loyalty_events (card_id, order_id, kind);

CREATE TABLE IF NOT EXISTS inventory_movements (
  id text PRIMARY KEY NOT NULL,
  product_id text NOT NULL,
  order_id text,
  kind text NOT NULL,
  qty_delta integer NOT NULL,
  reason text NOT NULL,
  actor text NOT NULL,
  created_at text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS inventory_product_order_kind ON inventory_movements (product_id, order_id, kind);

CREATE TABLE IF NOT EXISTS product_costs (
  product_id text PRIMARY KEY NOT NULL,
  unit_cost double precision NOT NULL,
  updated_at text NOT NULL
);

CREATE TABLE IF NOT EXISTS cash_sessions (
  id text PRIMARY KEY NOT NULL,
  opened_by text NOT NULL,
  opened_at text NOT NULL,
  opening_float double precision NOT NULL,
  closed_by text,
  closed_at text,
  counted_cash double precision,
  expected_cash double precision,
  variance double precision,
  notes text DEFAULT '' NOT NULL,
  status text DEFAULT 'open' NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS cash_session_one_open ON cash_sessions (status) WHERE status = 'open';

CREATE TABLE IF NOT EXISTS cash_entries (
  id text PRIMARY KEY NOT NULL,
  session_id text NOT NULL,
  order_id text,
  kind text NOT NULL,
  amount double precision NOT NULL,
  payment_method text NOT NULL,
  note text DEFAULT '' NOT NULL,
  actor text NOT NULL,
  created_at text NOT NULL
);

CREATE TABLE IF NOT EXISTS order_payments (
  id text PRIMARY KEY NOT NULL,
  order_id text NOT NULL UNIQUE,
  received_by text NOT NULL,
  method text NOT NULL,
  amount double precision NOT NULL,
  received_at text NOT NULL,
  cash_session_id text
);

CREATE TABLE IF NOT EXISTS expenses (
  id text PRIMARY KEY NOT NULL,
  occurred_at text NOT NULL,
  category text NOT NULL,
  amount double precision NOT NULL,
  payment_method text NOT NULL,
  note text NOT NULL,
  actor text NOT NULL,
  cash_session_id text
);

CREATE TABLE IF NOT EXISTS admin_login_challenges (
  id text PRIMARY KEY,
  username text NOT NULL,
  requested_at bigint NOT NULL,
  expires_at bigint NOT NULL,
  status text NOT NULL,
  code_hash text,
  attempts integer NOT NULL DEFAULT 0,
  approved_by text,
  used_at bigint
);

CREATE TABLE IF NOT EXISTS order_tracking_attempts (
  ip_hash text NOT NULL,
  attempted_at bigint NOT NULL
);
