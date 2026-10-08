import { z } from "zod";

/** Opaque record identifier (UUIDs in the database, any string in imported fake data). */
export const IdSchema = z.string().min(1).max(64);

/** Calendar date, e.g. `2026-10-08`. */
export const IsoDateSchema = z.iso.date();

/** Timestamp with `Z` or an explicit UTC offset, e.g. `2026-10-08T14:30:00Z`. */
export const IsoDateTimeSchema = z.iso.datetime({ offset: true });

/** Error body returned by apps/api for any non-2xx response. */
export const ApiErrorSchema = z.object({
  statusCode: z.int(),
  error: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
});

export type Id = z.infer<typeof IdSchema>;
export type IsoDate = z.infer<typeof IsoDateSchema>;
export type IsoDateTime = z.infer<typeof IsoDateTimeSchema>;
export type ApiError = z.infer<typeof ApiErrorSchema>;
