CREATE TABLE `intake_senders` (
	`id` text PRIMARY KEY NOT NULL,
	`mailbox_id` text NOT NULL,
	`target_id` text NOT NULL,
	`kind` text NOT NULL,
	`value` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`mailbox_id`) REFERENCES `mailboxes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_id`) REFERENCES `targets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `intake_senders_value_idx` ON `intake_senders` (`mailbox_id`,`value`);--> statement-breakpoint
ALTER TABLE `mailboxes` ADD `company_mail` text DEFAULT 'privacy_only' NOT NULL;--> statement-breakpoint
ALTER TABLE `mailboxes` ADD `reply_alias` text;--> statement-breakpoint
ALTER TABLE `mailboxes` ADD `reply_alias_verified_at` text;--> statement-breakpoint
ALTER TABLE `mailboxes` ADD `last_poll_scanned` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `mailboxes` ADD `last_poll_kept` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `mailboxes` ADD `intake_cleanup` text DEFAULT 'done' NOT NULL;--> statement-breakpoint
ALTER TABLE `mailboxes` ADD `intake_cleanup_removed` integer;--> statement-breakpoint
ALTER TABLE `mailboxes` ADD `intake_cleanup_at` text;--> statement-breakpoint
ALTER TABLE `mailboxes` ADD `intake_notice_seen_at` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `admitted_by` text;--> statement-breakpoint
UPDATE `mailboxes` SET `intake_cleanup` = 'pending' WHERE `id` IN (SELECT DISTINCT `mailbox_id` FROM `messages`);
