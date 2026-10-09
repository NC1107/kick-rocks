ALTER TABLE `mailboxes` ADD `last_send_error` text;--> statement-breakpoint
UPDATE `mailboxes` SET `last_send_error` = `last_error`, `last_error` = NULL WHERE `last_error` LIKE 'Sending is paused%';