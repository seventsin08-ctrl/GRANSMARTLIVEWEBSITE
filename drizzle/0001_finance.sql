CREATE TABLE `product_costs` (
  `product_id` text PRIMARY KEY NOT NULL,
  `unit_cost` real NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `cash_sessions` (
  `id` text PRIMARY KEY NOT NULL,
  `opened_by` text NOT NULL,
  `opened_at` text NOT NULL,
  `opening_float` real NOT NULL,
  `closed_by` text,
  `closed_at` text,
  `counted_cash` real,
  `expected_cash` real,
  `variance` real,
  `notes` text DEFAULT '' NOT NULL,
  `status` text DEFAULT 'open' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cash_session_one_open` ON `cash_sessions` (`status`) WHERE `status` = 'open';
--> statement-breakpoint
CREATE TABLE `cash_entries` (
  `id` text PRIMARY KEY NOT NULL,
  `session_id` text NOT NULL,
  `order_id` text,
  `kind` text NOT NULL,
  `amount` real NOT NULL,
  `payment_method` text NOT NULL,
  `note` text DEFAULT '' NOT NULL,
  `actor` text NOT NULL,
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `order_payments` (
  `id` text PRIMARY KEY NOT NULL,
  `order_id` text NOT NULL UNIQUE,
  `received_by` text NOT NULL,
  `method` text NOT NULL,
  `amount` real NOT NULL,
  `received_at` text NOT NULL,
  `cash_session_id` text
);
--> statement-breakpoint
CREATE TABLE `expenses` (
  `id` text PRIMARY KEY NOT NULL,
  `occurred_at` text NOT NULL,
  `category` text NOT NULL,
  `amount` real NOT NULL,
  `payment_method` text NOT NULL,
  `note` text NOT NULL,
  `actor` text NOT NULL,
  `cash_session_id` text
);
