CREATE TABLE `scan_preferences` (
	`profile_id` text NOT NULL,
	`target_id` text NOT NULL,
	`mode` text DEFAULT 'auto' NOT NULL,
	`paused_until` text,
	`rescan_days` integer,
	`auto_rescan` integer DEFAULT true NOT NULL,
	`include_past_addresses` integer DEFAULT false NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`profile_id`, `target_id`),
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_id`) REFERENCES `targets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `scans_profile_target_started_idx` ON `scans` (`profile_id`,`target_id`,`started_at`);