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
ALTER TABLE `mailboxes` ADD `company_mail` text DEFAULT 'privacy_only' NOT NULL;--> statement-breakpoint
ALTER TABLE `mailboxes` ADD `reply_alias` text;--> statement-breakpoint
ALTER TABLE `mailboxes` ADD `reply_alias_verified_at` text;--> statement-breakpoint
ALTER TABLE `mailboxes` ADD `last_poll_scanned` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `mailboxes` ADD `last_poll_kept` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `mailboxes` ADD `intake_cleanup` text DEFAULT 'done' NOT NULL;--> statement-breakpoint
ALTER TABLE `mailboxes` ADD `intake_cleanup_removed` integer;--> statement-breakpoint
ALTER TABLE `mailboxes` ADD `intake_cleanup_at` text;--> statement-breakpoint
ALTER TABLE `mailboxes` ADD `intake_shadow_until` text;--> statement-breakpoint
ALTER TABLE `mailboxes` ADD `intake_shadow_dismissed_at` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `admitted_by` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `cleanup_candidate` integer DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE `mailboxes` SET `intake_cleanup` = 'pending' WHERE `id` IN (SELECT DISTINCT `mailbox_id` FROM `messages`);--> statement-breakpoint
UPDATE `mailboxes` SET `intake_shadow_until` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+7 days');
