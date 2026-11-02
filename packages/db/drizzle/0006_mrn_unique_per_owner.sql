-- MRNs are unique per doctor, so each one can import the same synthetic patients.
-- (Hand-edited: drizzle-kit quotes the expression as column names.)
DROP INDEX `patients_mrn_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `patients_owner_mrn_unique` ON `patients` (coalesce(`owner_id`, ''), `mrn`);
