CREATE TABLE `chat_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`patient_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`tool_calls` text DEFAULT '[]' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "chat_messages_role_check" CHECK("chat_messages"."role" in ('user', 'assistant'))
);
--> statement-breakpoint
CREATE INDEX `chat_messages_patient_created_idx` ON `chat_messages` (`patient_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `lab_results` (
	`id` text PRIMARY KEY NOT NULL,
	`patient_id` text NOT NULL,
	`test_name` text NOT NULL,
	`value` real NOT NULL,
	`unit` text NOT NULL,
	`reference_low` real,
	`reference_high` real,
	`flag` text,
	`collected_at` text NOT NULL,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "lab_results_flag_check" CHECK("lab_results"."flag" in ('low', 'normal', 'high', 'critical'))
);
--> statement-breakpoint
CREATE INDEX `lab_results_patient_collected_idx` ON `lab_results` (`patient_id`,`collected_at`);--> statement-breakpoint
CREATE INDEX `lab_results_patient_test_idx` ON `lab_results` (`patient_id`,`test_name`);--> statement-breakpoint
CREATE TABLE `medications` (
	`id` text PRIMARY KEY NOT NULL,
	`patient_id` text NOT NULL,
	`name` text NOT NULL,
	`dosage` text NOT NULL,
	`frequency` text NOT NULL,
	`route` text,
	`status` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "medications_status_check" CHECK("medications"."status" in ('active', 'stopped'))
);
--> statement-breakpoint
CREATE INDEX `medications_patient_status_idx` ON `medications` (`patient_id`,`status`);--> statement-breakpoint
CREATE TABLE `patients` (
	`id` text PRIMARY KEY NOT NULL,
	`mrn` text NOT NULL,
	`first_name` text NOT NULL,
	`last_name` text NOT NULL,
	`date_of_birth` text NOT NULL,
	`sex` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`diagnosis` text NOT NULL,
	`surgery_date` text,
	`notes` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT "patients_sex_check" CHECK("patients"."sex" in ('female', 'male', 'other', 'unknown')),
	CONSTRAINT "patients_status_check" CHECK("patients"."status" in ('active', 'inactive'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `patients_mrn_unique` ON `patients` (`mrn`);--> statement-breakpoint
CREATE INDEX `patients_status_idx` ON `patients` (`status`);--> statement-breakpoint
CREATE TABLE `recovery_milestones` (
	`id` text PRIMARY KEY NOT NULL,
	`patient_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`target_date` text,
	`achieved_at` text,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "recovery_milestones_status_check" CHECK("recovery_milestones"."status" in ('pending', 'achieved', 'missed'))
);
--> statement-breakpoint
CREATE INDEX `recovery_milestones_patient_status_idx` ON `recovery_milestones` (`patient_id`,`status`);--> statement-breakpoint
CREATE TABLE `symptoms` (
	`id` text PRIMARY KEY NOT NULL,
	`patient_id` text NOT NULL,
	`name` text NOT NULL,
	`severity` integer NOT NULL,
	`notes` text,
	`recorded_at` text NOT NULL,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "symptoms_severity_check" CHECK("symptoms"."severity" between 0 and 10)
);
--> statement-breakpoint
CREATE INDEX `symptoms_patient_recorded_idx` ON `symptoms` (`patient_id`,`recorded_at`);--> statement-breakpoint
CREATE TABLE `vital_signs` (
	`id` text PRIMARY KEY NOT NULL,
	`patient_id` text NOT NULL,
	`type` text NOT NULL,
	`value` real NOT NULL,
	`unit` text NOT NULL,
	`recorded_at` text NOT NULL,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "vital_signs_type_check" CHECK("vital_signs"."type" in ('heart_rate', 'blood_pressure_systolic', 'blood_pressure_diastolic', 'temperature', 'respiratory_rate', 'oxygen_saturation', 'weight', 'pain_score'))
);
--> statement-breakpoint
CREATE INDEX `vital_signs_patient_type_recorded_idx` ON `vital_signs` (`patient_id`,`type`,`recorded_at`);