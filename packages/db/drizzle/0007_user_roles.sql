-- Roles: doctors (as before) and patient accounts, each tied to one patient record and
-- deleted with it. Hand-edited: drizzle-kit leaves out ON DELETE, and the checks are column
-- checks, so the table is altered rather than rebuilt (a rebuild would clear patients' owners).
ALTER TABLE `users` ADD `role` text DEFAULT 'doctor' NOT NULL
	CHECK (`role` IN ('doctor', 'patient'));--> statement-breakpoint
ALTER TABLE `users` ADD `patient_id` text REFERENCES patients(id) ON DELETE cascade
	CHECK ((`role` = 'patient') = (`patient_id` IS NOT NULL));--> statement-breakpoint
ALTER TABLE `users` ADD `must_change_password` integer DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `users_patient_unique` ON `users` (`patient_id`);
