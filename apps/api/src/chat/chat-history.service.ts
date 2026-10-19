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

  /** A tool call in the patient's history, or `undefined`. Throws 404 if the patient does not exist. */
  findToolCall(patientId: string, toolCallId: string): ToolCall | undefined {
    return this.list(patientId)
      .flatMap((message) => message.toolCalls)
      .find((call) => call.id === toolCallId);
  }

  /** Replaces a saved tool call (matched by id) in the patient's history. */
  updateToolCall(patientId: string, updated: ToolCall): void {
    const message = this.list(patientId).find((m) => m.toolCalls.some((c) => c.id === updated.id));
    if (!message) return;
    this.database.db
      .update(chatMessages)
      .set({
        toolCalls: message.toolCalls.map((call) => (call.id === updated.id ? updated : call)),
      })
      .where(eq(chatMessages.id, message.id))
      .run();
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
