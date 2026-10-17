import { type ChatMessageRow, chatMessages } from "@health-mcp/db";
import type { ChatMessage, ChatRole, ToolCall } from "@health-mcp/shared";
import { Injectable } from "@nestjs/common";
import { asc, eq, sql } from "drizzle-orm";

import { DatabaseService } from "../database/database.service.js";
import { PatientsService } from "../patients/patients.service.js";

export interface NewChatMessage {
  /** Optional preset id, e.g. when the id was already announced in a stream. */
  id?: string;
  role: ChatRole;
  content: string;
  toolCalls?: ToolCall[];
}

const toChatMessage = ({
  id,
  patientId,
  role,
  content,
  toolCalls,
  createdAt,
}: ChatMessageRow): ChatMessage => ({
  id,
  patientId,
  role,
  content,
  toolCalls,
  createdAt,
});

/** Reads and writes one patient's chat history. */
@Injectable()
export class ChatHistoryService {
  constructor(
    private readonly database: DatabaseService,
    private readonly patients: PatientsService,
  ) {}

  /** Messages oldest first. Throws 404 if the patient does not exist. */
  list(patientId: string): ChatMessage[] {
    this.patients.get(patientId);
    return (
      this.database.db
        .select()
        .from(chatMessages)
        .where(eq(chatMessages.patientId, patientId))
        // createdAt has millisecond precision; rowid keeps insertion order for messages saved in the same millisecond.
        .orderBy(asc(chatMessages.createdAt), asc(sql`rowid`))
        .all()
        .map(toChatMessage)
    );
  }

  /** Saves a message to the patient's history. Throws 404 if the patient does not exist. */
  append(patientId: string, message: NewChatMessage): ChatMessage {
    this.patients.get(patientId);
    const [row] = this.database.db
      .insert(chatMessages)
      .values({
        ...(message.id !== undefined && { id: message.id }),
        patientId,
        role: message.role,
        content: message.content,
        toolCalls: message.toolCalls ?? [],
      })
      .returning()
      .all();
    return toChatMessage(row!);
  }
}
