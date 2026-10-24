CREATE TABLE `record_chunks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`patient_id` text NOT NULL,
	`source_type` text NOT NULL,
	`source_id` text NOT NULL,
	`source_date` text NOT NULL,
	`chunk_index` integer NOT NULL,
	`text` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "record_chunks_source_type_check" CHECK("record_chunks"."source_type" in ('imaging_report', 'patient_notes', 'symptom', 'chat_message'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `record_chunks_source_uidx` ON `record_chunks` (`source_type`,`source_id`,`chunk_index`);--> statement-breakpoint
CREATE INDEX `record_chunks_patient_idx` ON `record_chunks` (`patient_id`);