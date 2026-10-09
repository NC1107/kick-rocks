CREATE TABLE `reply_predictions` (
	`message_id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`model_version` text,
	`model_label` text,
	`model_confidence` real,
	`probabilities` text,
	`rules_label` text NOT NULL,
	`rules_confidence` real NOT NULL,
	`input_sha256` text,
	`auto_applied` integer NOT NULL,
	`spot_check` integer NOT NULL,
	`person_label` text,
	`accepted_suggestion` integer,
	`decided_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `reply_predictions_spot_idx` ON `reply_predictions` (`spot_check`,`decided_at`);