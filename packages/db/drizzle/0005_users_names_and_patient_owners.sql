-- Patients belong to the doctor who created them; removing the doctor keeps them, unassigned.
-- (Hand-edited: drizzle-kit leaves out ON DELETE when it adds a column.)
ALTER TABLE `patients` ADD `owner_id` text REFERENCES users(id) ON DELETE set null;--> statement-breakpoint
CREATE INDEX `patients_owner_idx` ON `patients` (`owner_id`);--> statement-breakpoint
-- Users get a first and last name instead of one optional name. Existing names are split at the
-- first space; the empty default only fills existing rows (the app always sets both).
ALTER TABLE `users` ADD `first_name` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `last_name` text DEFAULT '' NOT NULL;--> statement-breakpoint
UPDATE `users` SET
	`first_name` = CASE WHEN instr(trim(`name`), ' ') > 0
		THEN substr(trim(`name`), 1, instr(trim(`name`), ' ') - 1)
		ELSE coalesce(trim(`name`), '') END,
	`last_name` = CASE WHEN instr(trim(`name`), ' ') > 0
		THEN trim(substr(trim(`name`), instr(trim(`name`), ' ') + 1))
		ELSE '' END;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `name`;
