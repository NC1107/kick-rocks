CREATE TABLE `claimers` (
	`kind` text NOT NULL,
	`worker_id` text NOT NULL,
	`model` text,
	`version` text,
	`busy` integer DEFAULT false NOT NULL,
	`current_task_id` text,
	`result_pending` integer DEFAULT false NOT NULL,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	PRIMARY KEY(`kind`, `worker_id`)
);
--> statement-breakpoint
CREATE INDEX `claimers_seen_idx` ON `claimers` (`last_seen_at`);--> statement-breakpoint
ALTER TABLE `tasks` ADD `assignment` text;
--> statement-breakpoint
DELETE FROM `settings` WHERE `key` IN ('worker.status.builtin', 'worker.status.model');
