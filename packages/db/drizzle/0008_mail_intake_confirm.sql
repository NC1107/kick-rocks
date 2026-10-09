CREATE TABLE `ignored_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`mailbox_id` text NOT NULL,
	`imap_uid` integer NOT NULL,
	`uid_validity` integer NOT NULL,
	`message_id_header` text,
	`in_reply_to` text,
	`from_address` text NOT NULL,
	`subject` text NOT NULL,
	`received_at` text NOT NULL,
	`classification` text NOT NULL,
	`confidence` real NOT NULL,
	`rationale` text,
	`links` text NOT NULL,
	`snippet` text,
	`text` text,
	`ignored_at` text NOT NULL,
	FOREIGN KEY (`mailbox_id`) REFERENCES `mailboxes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ignored_messages_mailbox_idx` ON `ignored_messages` (`mailbox_id`,`ignored_at`);--> statement-breakpoint
CREATE TABLE `intake_shadow` (
	`id` text PRIMARY KEY NOT NULL,
	`mailbox_id` text NOT NULL,
	`imap_uid` integer NOT NULL,
	`uid_validity` integer NOT NULL,
	`from_address` text NOT NULL,
	`subject` text NOT NULL,
	`received_at` text NOT NULL,
	`rule` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`mailbox_id`) REFERENCES `mailboxes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `intake_shadow_uid_idx` ON `intake_shadow` (`mailbox_id`,`uid_validity`,`imap_uid`);--> statement-breakpoint
ALTER TABLE `mailboxes` ADD `intake_shadow_until` text;--> statement-breakpoint
ALTER TABLE `mailboxes` ADD `intake_shadow_dismissed_at` text;--> statement-breakpoint
ALTER TABLE `mailboxes` DROP COLUMN `intake_notice_seen_at`;--> statement-breakpoint
ALTER TABLE `messages` ADD `cleanup_candidate` integer DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE `mailboxes` SET `intake_shadow_until` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+7 days');
