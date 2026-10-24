-- Search indexes for record_chunks (RAG). Hand-written: drizzle
-- cannot describe virtual tables. Needs the sqlite-vec extension, which
-- createDb() loads on every connection.

-- One embedding per chunk, rowid = record_chunks.id. The patient is a
-- partition key, so a nearest-neighbour search only reads that patient's
-- vectors. 384 = EMBEDDING_DIMENSIONS (bge-small-en-v1.5).
-- vec0 does not accept quoted column names.
CREATE VIRTUAL TABLE `vec_chunks` USING vec0(
	patient_id text partition key,
	embedding float[384] distance_metric=cosine
);
--> statement-breakpoint
-- Keyword index over the chunk text, stored only once (external content).
-- The porter stemmer matches "headaches" to "headache".
CREATE VIRTUAL TABLE `chunks_fts` USING fts5(
	`text`,
	content='record_chunks',
	content_rowid='id',
	tokenize='porter unicode61'
);
--> statement-breakpoint
CREATE TRIGGER `record_chunks_after_insert` AFTER INSERT ON `record_chunks` BEGIN
	INSERT INTO `chunks_fts` (rowid, `text`) VALUES (new.`id`, new.`text`);
END;
--> statement-breakpoint
CREATE TRIGGER `record_chunks_after_update` AFTER UPDATE OF `text` ON `record_chunks` BEGIN
	INSERT INTO `chunks_fts` (`chunks_fts`, rowid, `text`) VALUES ('delete', old.`id`, old.`text`);
	INSERT INTO `chunks_fts` (rowid, `text`) VALUES (new.`id`, new.`text`);
END;
--> statement-breakpoint
-- Also fires for chunks removed by ON DELETE CASCADE when a patient is deleted.
CREATE TRIGGER `record_chunks_after_delete` AFTER DELETE ON `record_chunks` BEGIN
	DELETE FROM `vec_chunks` WHERE rowid = old.`id`;
	INSERT INTO `chunks_fts` (`chunks_fts`, rowid, `text`) VALUES ('delete', old.`id`, old.`text`);
END;
