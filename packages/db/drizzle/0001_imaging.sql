CREATE TABLE `imaging_series` (
	`id` text PRIMARY KEY NOT NULL,
	`study_id` text NOT NULL,
	`series_number` integer,
	`description` text,
	`modality` text NOT NULL,
	`image_count` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`study_id`) REFERENCES `imaging_studies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `imaging_series_study_idx` ON `imaging_series` (`study_id`);--> statement-breakpoint
CREATE TABLE `imaging_studies` (
	`id` text PRIMARY KEY NOT NULL,
	`patient_id` text NOT NULL,
	`modality` text NOT NULL,
	`body_part` text,
	`description` text,
	`study_date` text NOT NULL,
	`impression` text,
	`report` text,
	`source` text NOT NULL,
	`dicom_study_hash` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "imaging_studies_source_check" CHECK("imaging_studies"."source" in ('import', 'dicom'))
);
--> statement-breakpoint
CREATE INDEX `imaging_studies_patient_date_idx` ON `imaging_studies` (`patient_id`,`study_date`);--> statement-breakpoint
CREATE UNIQUE INDEX `imaging_studies_patient_dicom_uidx` ON `imaging_studies` (`patient_id`,`dicom_study_hash`);