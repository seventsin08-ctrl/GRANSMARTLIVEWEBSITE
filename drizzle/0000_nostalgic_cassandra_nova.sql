CREATE TABLE `attendance` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`clock_in` text NOT NULL,
	`clock_out` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `attendance_one_active` ON `attendance` (`username`) WHERE "attendance"."clock_out" IS NULL;--> statement-breakpoint
CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `inventory_movements` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`order_id` text,
	`kind` text NOT NULL,
	`qty_delta` integer NOT NULL,
	`reason` text NOT NULL,
	`actor` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inventory_product_order_kind` ON `inventory_movements` (`product_id`,`order_id`,`kind`);--> statement-breakpoint
CREATE TABLE `login_attempts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ip_hash` text NOT NULL,
	`attempted_at` integer NOT NULL,
	`succeeded` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `loyalty_cards` (
	`id` text PRIMARY KEY NOT NULL,
	`code_hash` text NOT NULL,
	`suffix` text NOT NULL,
	`points` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `loyalty_cards_code_hash_unique` ON `loyalty_cards` (`code_hash`);--> statement-breakpoint
CREATE TABLE `loyalty_events` (
	`id` text PRIMARY KEY NOT NULL,
	`card_id` text NOT NULL,
	`order_id` text,
	`kind` text NOT NULL,
	`amount` integer NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`actor` text DEFAULT 'system' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `loyalty_card_order_kind` ON `loyalty_events` (`card_id`,`order_id`,`kind`);--> statement-breakpoint
CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`number` text NOT NULL,
	`created_at` text NOT NULL,
	`items` text NOT NULL,
	`total` real NOT NULL,
	`method` text NOT NULL,
	`details` text NOT NULL,
	`payment_method` text NOT NULL,
	`paid` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`loyalty_card_id` text,
	`reward_product_id` text,
	`reward_applied` integer DEFAULT 0 NOT NULL,
	`reward_points` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`category_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`price` real NOT NULL,
	`image` text DEFAULT '' NOT NULL,
	`available` integer DEFAULT 1 NOT NULL,
	`featured` integer DEFAULT 0 NOT NULL,
	`customization` integer DEFAULT 0 NOT NULL,
	`track_stock` integer DEFAULT 0 NOT NULL,
	`stock_qty` integer DEFAULT 0 NOT NULL,
	`stock_unit` text DEFAULT 'each' NOT NULL,
	`low_threshold` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `schedules` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`shift_date` text NOT NULL,
	`start_time` text NOT NULL,
	`end_time` text NOT NULL,
	`note` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `staff` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text NOT NULL,
	`permissions` text NOT NULL,
	`active` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `staff_username_unique` ON `staff` (`username`);