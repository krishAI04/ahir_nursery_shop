CREATE TABLE `login_failures` (
	`id` integer PRIMARY KEY NOT NULL,
	`ip` text NOT NULL,
	`at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `login_failures_ip_at_idx` ON `login_failures` (`ip`,`at`);