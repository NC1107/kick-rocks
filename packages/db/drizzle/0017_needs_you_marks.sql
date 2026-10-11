CREATE TABLE `needs_you_marks` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`task_id` text,
	`match_id` text,
	`request_id` text,
	`snoozed_until` text,
	`opened_at` text,
	`tries` integer DEFAULT 0 NOT NULL,
	`last_tried_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`match_id`) REFERENCES `matches`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`request_id`) REFERENCES `requests`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "needs_you_marks_one_subject" CHECK(("needs_you_marks"."task_id" is not null) + ("needs_you_marks"."match_id" is not null) + ("needs_you_marks"."request_id" is not null) = 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `needs_you_marks_task_idx` ON `needs_you_marks` (`task_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `needs_you_marks_match_idx` ON `needs_you_marks` (`match_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `needs_you_marks_request_idx` ON `needs_you_marks` (`request_id`);--> statement-breakpoint
CREATE INDEX `needs_you_marks_profile_idx` ON `needs_you_marks` (`profile_id`);