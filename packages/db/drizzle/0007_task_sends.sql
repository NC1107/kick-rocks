CREATE TABLE `task_sends` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`attempt` integer NOT NULL,
	`seq` integer NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`request` text NOT NULL,
	`reason` text,
	`spends_send_id` text,
	`screenshot_artifact_id` text,
	`expires_at` text,
	`decided_by` text,
	`decided_at` text,
	`released_at` text,
	`response_status` integer,
	`response_error` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`spends_send_id`) REFERENCES `task_sends`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`screenshot_artifact_id`) REFERENCES `task_artifacts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `task_sends_task_idx` ON `task_sends` (`task_id`,`attempt`,`seq`);--> statement-breakpoint
UPDATE `tasks` SET `submit_approval` = 'required' WHERE `submit_approval` IN ('granted', 'used');--> statement-breakpoint
ALTER TABLE `tasks` DROP COLUMN `submit_stop`;