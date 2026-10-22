# RAG with a vector database: two options

Proposals for adding retrieval-augmented generation (RAG) to the assistant, for learning purposes. Both keep today's architecture ([architecture.png](architecture.png)) and add to it; new parts are dashed magenta in the diagrams. Synthetic data only, as everywhere in this repo.

| | [Option A](rag-option-a.png): patient records | [Option B](rag-option-b.png): medical knowledge base |
|---|---|---|
| **What is embedded** | Each patient's own free text: radiology reports, impressions, clinician notes, symptom notes, past chat messages | Public reference texts: drug labels, condition and treatment guides (public-domain or openly licensed) |
| **Vector store** | `sqlite-vec` inside the existing SQLite file: no new service | Qdrant, a separate vector database in Docker |
| **Who decides to retrieve** | The model, through a new MCP tool `search_patient_records` (agentic RAG) | The api, before every answer (classic retrieve-then-generate pipeline) |
| **Embeddings** | Local model (`bge-small-en-v1.5` via transformers.js, 384 dimensions) | Embedding API (Voyage AI, 1024 dimensions) |
| **Search** | Vector nearest neighbours + SQLite FTS5 keywords, merged with reciprocal rank fusion | Qdrant hybrid query (dense + sparse BM25), then a reranker |
| **When indexing happens** | On every write, in the same transaction as the record | A batch job: `yarn kb:ingest`, re-run when sources change |
| **Isolation** | Every chunk carries `patient_id`; the api sets it on the tool call, as for every other tool | Shared corpus, no patient data in it |
| **Privacy** | No text leaves the machine for retrieval | The question text goes to the embedding API |
| **Answer format** | The model cites the record (report, note, date) the passage came from; the chat's tool card shows the passages | Numbered citations `[1]`–`[5]` with a Sources list |
| **Infrastructure** | One SQLite extension and one npm model package | Docker, Qdrant, an embedding API key |

## What each teaches

**Option A** covers chunking real records, local embeddings, metadata filtering for multi-tenant isolation, keeping an index consistent with its source (insert, update, delete), hybrid search, and agentic retrieval through MCP. It answers questions the structured tools cannot, such as "Has she mentioned dizziness before?" or "What did the reports say about the cavity over time?".

**Option B** covers an ingestion pipeline (loading, cleaning, chunking by structure, batching, idempotent re-runs), operating a dedicated vector database, collections and payloads, hybrid dense + sparse search, reranking, prompt assembly with citations, and grounding answers in sources. It answers general questions, such as "What are the common side effects of temozolomide?", with a source the clinician can check.

They are complementary: A grounds answers in this patient's history, B in outside knowledge. Doing A first needs no new infrastructure and reuses the MCP tool pattern; B then adds a real vector database service.

## Plan for option A

1. **Schema:** `record_chunks` (patient, source type and id, date, text) plus a `vec0` virtual table and an FTS5 table, in a migration. Load `sqlite-vec` in `createDb`.
2. **`packages/rag`:** chunker, local embedder (model downloaded once into `data/models/`), and `search(patientId, query, k)` with reciprocal rank fusion.
3. **Indexing:** an `IndexingService` in the api, called wherever text is saved; `yarn rag:reindex` rebuilds everything (also after changing the model or chunk size).
4. **Tool:** `search_patient_records` in the shared contract and the MCP server; a minimum similarity score so it can answer "nothing relevant".
5. **Web:** the search card shows each passage with a link to its source.
6. **Evals:** cases where the answer is only in free text (a note or an old report), plus retrieval metrics (did the right chunk appear in the top 5).

## Plan for option B

1. **Qdrant:** `docker-compose.yml`, `QDRANT_URL`, and a `medical_kb` collection with dense and sparse vectors.
2. **`apps/ingest`:** loaders for a few sources (start with openFDA drug labels for the medications in the fixture), chunking by heading, batch embedding, upserts keyed by a content hash. Record each chunk's source, URL and license.
3. **`RetrievalService`:** embed, hybrid search (top 20), rerank (keep 5), and add the passages to the system prompt with ids; skip retrieval for small talk.
4. **Citations:** the prompt asks the model to cite `[n]`; the stream carries the sources, and the web shows a Sources list.
5. **Evals:** questions with known answers in the corpus, checking the cited source and that unsupported claims are not made; track tokens and cost per answer as today.

## Open choices

- **Embedding model:** local (free, private, smaller) or an API (stronger, costs money, sends text out). Check current model names before building; the ones above are examples.
- **Chunk size and overlap:** start with the sizes in the diagrams and tune them with the evals.
- **Option B's sources:** use only content whose license allows storing and showing it; record the license per chunk.
