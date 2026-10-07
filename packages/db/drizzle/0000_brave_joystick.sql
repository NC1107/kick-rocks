CREATE TABLE `identities` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`kind` text NOT NULL,
	`value` text NOT NULL,
	`is_primary` integer DEFAULT false NOT NULL,
	`valid_from` text,
	`valid_to` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `identities_profile_idx` ON `identities` (`profile_id`);--> statement-breakpoint
CREATE TABLE `mailboxes` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`provider` text NOT NULL,
	`address` text NOT NULL,
	`smtp_host` text NOT NULL,
	`smtp_port` integer NOT NULL,
	`smtp_secure` integer NOT NULL,
	`imap_host` text NOT NULL,
	`imap_port` integer NOT NULL,
	`username` text NOT NULL,
	`secret` text NOT NULL,
	`reply_folder` text DEFAULT 'INBOX' NOT NULL,
	`daily_cap` integer NOT NULL,
	`last_poll_uid` integer,
	`last_polled_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `matches` (
	`id` text PRIMARY KEY NOT NULL,
	`scan_id` text NOT NULL,
	`record_url` text NOT NULL,
	`fields` text NOT NULL,
	`decision` text DEFAULT 'pending' NOT NULL,
	`decided_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`scan_id`) REFERENCES `scans`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `matches_scan_idx` ON `matches` (`scan_id`);--> statement-breakpoint
CREATE INDEX `matches_decision_idx` ON `matches` (`decision`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`mailbox_id` text NOT NULL,
	`imap_uid` integer NOT NULL,
	`request_id` text,
	`from_address` text NOT NULL,
	`subject` text NOT NULL,
	`received_at` text NOT NULL,
	`classification` text NOT NULL,
	`confidence` real NOT NULL,
	`headers` text NOT NULL,
	`snippet` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`mailbox_id`) REFERENCES `mailboxes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`request_id`) REFERENCES `requests`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `messages_mailbox_uid_idx` ON `messages` (`mailbox_id`,`imap_uid`);--> statement-breakpoint
CREATE INDEX `messages_request_idx` ON `messages` (`request_id`);--> statement-breakpoint
CREATE TABLE `profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`state` text(2) NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `recipes` (
	`id` text PRIMARY KEY NOT NULL,
	`target_id` text NOT NULL,
	`purpose` text NOT NULL,
	`version` integer NOT NULL,
	`definition` text NOT NULL,
	`health` text DEFAULT 'unknown' NOT NULL,
	`last_checked_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`target_id`) REFERENCES `targets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recipes_target_purpose_version_idx` ON `recipes` (`target_id`,`purpose`,`version`);--> statement-breakpoint
CREATE TABLE `request_events` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`type` text NOT NULL,
	`payload` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`request_id`) REFERENCES `requests`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `request_events_request_idx` ON `request_events` (`request_id`);--> statement-breakpoint
CREATE TABLE `requests` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`target_id` text NOT NULL,
	`right` text NOT NULL,
	`legal_basis` text NOT NULL,
	`channel` text NOT NULL,
	`status` text NOT NULL,
	`reference` text NOT NULL,
	`sent_at` text,
	`due_at` text,
	`follow_up_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_id`) REFERENCES `targets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `requests_profile_idx` ON `requests` (`profile_id`);--> statement-breakpoint
CREATE INDEX `requests_status_idx` ON `requests` (`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `requests_reference_idx` ON `requests` (`reference`);--> statement-breakpoint
CREATE TABLE `scans` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`target_id` text NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`candidates` text,
	`error` text,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_id`) REFERENCES `targets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `scans_profile_idx` ON `scans` (`profile_id`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `targets` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`domain` text NOT NULL,
	`website` text,
	`privacy_email` text,
	`opt_out_url` text,
	`privacy_rights_url` text,
	`contact_method` text NOT NULL,
	`region` text NOT NULL,
	`requires_id` integer DEFAULT false NOT NULL,
	`data` text NOT NULL,
	`dataset_version` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `targets_kind_domain_idx` ON `targets` (`kind`,`domain`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`profile_id` text,
	`target_id` text,
	`request_id` text,
	`payload` text NOT NULL,
	`result` text,
	`blocked_reason` text,
	`screenshot_path` text,
	`lease_owner` text,
	`lease_expires_at` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`run_after` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_id`) REFERENCES `targets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`request_id`) REFERENCES `requests`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `tasks_status_kind_idx` ON `tasks` (`status`,`kind`);--> statement-breakpoint
CREATE INDEX `tasks_profile_idx` ON `tasks` (`profile_id`);