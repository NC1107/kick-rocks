CREATE TABLE `campaigns` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`rights` text NOT NULL,
	`selection` text NOT NULL,
	`created_count` integer NOT NULL,
	`skipped` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `identities` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`kind` text NOT NULL,
	`value` text NOT NULL,
	`is_primary` integer DEFAULT false NOT NULL,
	`valid_from` text,
	`valid_to` text,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `identities_profile_idx` ON `identities` (`profile_id`);--> statement-breakpoint
CREATE TABLE `mailboxes` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`provider` text NOT NULL,
	`address` text NOT NULL,
	`username` text NOT NULL,
	`secret` text NOT NULL,
	`smtp_host` text NOT NULL,
	`smtp_port` integer NOT NULL,
	`smtp_secure` integer NOT NULL,
	`imap_host` text NOT NULL,
	`imap_port` integer NOT NULL,
	`reply_folder` text DEFAULT 'INBOX' NOT NULL,
	`daily_cap` integer NOT NULL,
	`uid_validity` integer,
	`last_poll_uid` integer,
	`last_polled_at` text,
	`last_error` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mailboxes_profile_idx` ON `mailboxes` (`profile_id`);--> statement-breakpoint
CREATE TABLE `matches` (
	`id` text PRIMARY KEY NOT NULL,
	`scan_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`target_id` text NOT NULL,
	`record_url` text NOT NULL,
	`fields` text NOT NULL,
	`decision` text DEFAULT 'pending' NOT NULL,
	`decided_at` text,
	`request_id` text,
	FOREIGN KEY (`scan_id`) REFERENCES `scans`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_id`) REFERENCES `targets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`request_id`) REFERENCES `requests`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `matches_scan_idx` ON `matches` (`scan_id`);--> statement-breakpoint
CREATE INDEX `matches_profile_decision_idx` ON `matches` (`profile_id`,`decision`);--> statement-breakpoint
CREATE INDEX `matches_record_idx` ON `matches` (`profile_id`,`target_id`,`record_url`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`mailbox_id` text NOT NULL,
	`imap_uid` integer NOT NULL,
	`uid_validity` integer NOT NULL,
	`request_id` text,
	`message_id_header` text,
	`in_reply_to` text,
	`from_address` text NOT NULL,
	`subject` text NOT NULL,
	`received_at` text NOT NULL,
	`classification` text NOT NULL,
	`confidence` real NOT NULL,
	`rationale` text,
	`links` text NOT NULL,
	`requested_fields` text DEFAULT '[]' NOT NULL,
	`snippet` text,
	`text` text,
	`reviewed` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`mailbox_id`) REFERENCES `mailboxes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`request_id`) REFERENCES `requests`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `messages_mailbox_uid_idx` ON `messages` (`mailbox_id`,`uid_validity`,`imap_uid`);--> statement-breakpoint
CREATE INDEX `messages_request_idx` ON `messages` (`request_id`);--> statement-breakpoint
CREATE INDEX `messages_review_idx` ON `messages` (`reviewed`,`classification`);--> statement-breakpoint
CREATE TABLE `outgoing_mail` (
	`id` text PRIMARY KEY NOT NULL,
	`mailbox_id` text NOT NULL,
	`request_id` text NOT NULL,
	`kind` text NOT NULL,
	`message_id` text NOT NULL,
	`sent_at` text NOT NULL,
	FOREIGN KEY (`mailbox_id`) REFERENCES `mailboxes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`request_id`) REFERENCES `requests`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `outgoing_mail_mailbox_sent_idx` ON `outgoing_mail` (`mailbox_id`,`sent_at`);--> statement-breakpoint
CREATE INDEX `outgoing_mail_request_idx` ON `outgoing_mail` (`request_id`);--> statement-breakpoint
CREATE TABLE `profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`state` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `recipes` (
	`id` text PRIMARY KEY NOT NULL,
	`target_id` text NOT NULL,
	`purpose` text NOT NULL,
	`version` integer NOT NULL,
	`definition` text NOT NULL,
	`source` text NOT NULL,
	`status` text NOT NULL,
	`health` text DEFAULT 'unknown' NOT NULL,
	`failure_count` integer DEFAULT 0 NOT NULL,
	`last_checked_at` text,
	`notes` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`target_id`) REFERENCES `targets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recipes_target_purpose_version_idx` ON `recipes` (`target_id`,`purpose`,`version`);--> statement-breakpoint
CREATE INDEX `recipes_target_status_idx` ON `recipes` (`target_id`,`purpose`,`status`);--> statement-breakpoint
CREATE TABLE `request_events` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`type` text NOT NULL,
	`actor` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`request_id`) REFERENCES `requests`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `request_events_request_idx` ON `request_events` (`request_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `requests` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`target_id` text NOT NULL,
	`campaign_id` text,
	`mailbox_id` text,
	`rights` text NOT NULL,
	`legal_basis` text NOT NULL,
	`channel` text NOT NULL,
	`status` text NOT NULL,
	`reference` text NOT NULL,
	`outgoing_message_id` text,
	`record_url` text,
	`follow_ups` integer DEFAULT 0 NOT NULL,
	`sent_at` text,
	`due_at` text,
	`follow_up_at` text,
	`awaiting_confirmation_since` text,
	`last_error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_id`) REFERENCES `targets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`mailbox_id`) REFERENCES `mailboxes`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `requests_reference_idx` ON `requests` (`reference`);--> statement-breakpoint
CREATE INDEX `requests_profile_status_idx` ON `requests` (`profile_id`,`status`);--> statement-breakpoint
CREATE INDEX `requests_target_idx` ON `requests` (`target_id`);--> statement-breakpoint
CREATE INDEX `requests_outgoing_message_idx` ON `requests` (`outgoing_message_id`);--> statement-breakpoint
CREATE TABLE `scans` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`target_id` text NOT NULL,
	`task_id` text,
	`started_at` text NOT NULL,
	`finished_at` text,
	`candidates` text,
	`error` text,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_id`) REFERENCES `targets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `scans_profile_idx` ON `scans` (`profile_id`);--> statement-breakpoint
CREATE INDEX `scans_task_idx` ON `scans` (`task_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`user_agent` text
);
--> statement-breakpoint
CREATE INDEX `sessions_expires_idx` ON `sessions` (`expires_at`);--> statement-breakpoint
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
	`search_url` text,
	`contact_method` text NOT NULL,
	`region` text NOT NULL,
	`requires_id` integer DEFAULT false NOT NULL,
	`requirements` text NOT NULL,
	`priority` text NOT NULL,
	`data` text NOT NULL,
	`dataset_version` text NOT NULL,
	`retired` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `targets_kind_domain_idx` ON `targets` (`kind`,`domain`) WHERE "targets"."retired" = 0;--> statement-breakpoint
CREATE TABLE `task_artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`kind` text NOT NULL,
	`mime` text NOT NULL,
	`data` blob NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `task_artifacts_task_idx` ON `task_artifacts` (`task_id`);--> statement-breakpoint
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
	`blocked_detail` text,
	`blocked_url` text,
	`lease_owner` text,
	`lease_expires_at` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer NOT NULL,
	`run_after` text,
	`dedupe_key` text,
	`last_error` text,
	`failure_kind` text,
	`failure_step` integer,
	`finished_by` text,
	`claimer_kind` text,
	`usage` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_id`) REFERENCES `targets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`request_id`) REFERENCES `requests`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `tasks_claim_idx` ON `tasks` (`status`,`kind`,`priority`);--> statement-breakpoint
CREATE INDEX `tasks_profile_idx` ON `tasks` (`profile_id`);--> statement-breakpoint
CREATE INDEX `tasks_request_idx` ON `tasks` (`request_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `tasks_dedupe_live_idx` ON `tasks` (`dedupe_key`) WHERE "tasks"."status" in ('queued', 'leased', 'blocked');