CREATE TABLE `site_state` (
	`domain` text PRIMARY KEY NOT NULL,
	`next_start_after` text,
	`consecutive_pushback` integer DEFAULT 0 NOT NULL,
	`last_pushback_at` text,
	`last_pushback_kind` text,
	`cooling_down_until` text,
	`breaker` text DEFAULT 'closed' NOT NULL,
	`crawl_delay_seconds` real,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `site_visits` (
	`id` text PRIMARY KEY NOT NULL,
	`domain` text NOT NULL,
	`task_id` text NOT NULL,
	`started_at` text NOT NULL,
	`probe` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `site_visits_domain_started_idx` ON `site_visits` (`domain`,`started_at`);--> statement-breakpoint
CREATE INDEX `site_visits_started_idx` ON `site_visits` (`started_at`);--> statement-breakpoint
CREATE INDEX `site_visits_task_idx` ON `site_visits` (`task_id`);--> statement-breakpoint
ALTER TABLE `scans` ADD `search_key` text;--> statement-breakpoint
ALTER TABLE `scans` ADD `reused_from_scan_id` text;--> statement-breakpoint
CREATE INDEX `scans_search_key_idx` ON `scans` (`search_key`);