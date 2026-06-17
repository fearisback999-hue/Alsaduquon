CREATE TABLE `login_attempts` (
	`ip` text PRIMARY KEY NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`last_attempt_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `login_attempts_last_attempt_idx` ON `login_attempts` (`last_attempt_at`);