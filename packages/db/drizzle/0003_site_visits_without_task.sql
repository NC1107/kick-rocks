PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_site_visits` (
	`id` text PRIMARY KEY NOT NULL,
	`domain` text NOT NULL,
	`task_id` text,
	`started_at` text NOT NULL,
	`probe` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_site_visits`("id", "domain", "task_id", "started_at", "probe") SELECT "id", "domain", "task_id", "started_at", "probe" FROM `site_visits`;--> statement-breakpoint
DROP TABLE `site_visits`;--> statement-breakpoint
ALTER TABLE `__new_site_visits` RENAME TO `site_visits`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `site_visits_domain_started_idx` ON `site_visits` (`domain`,`started_at`);--> statement-breakpoint
CREATE INDEX `site_visits_started_idx` ON `site_visits` (`started_at`);--> statement-breakpoint
CREATE INDEX `site_visits_task_idx` ON `site_visits` (`task_id`);