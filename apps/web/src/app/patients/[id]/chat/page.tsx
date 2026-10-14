import Link from "next/link";
import { notFound } from "next/navigation";

import { api, ApiUnavailableError } from "@/lib/api-client";

import { ApiUnavailable } from "../../api-unavailable";

import { ChatTranscript } from "./chat-transcript";

export const dynamic = "force-dynamic";

export default async function PatientChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let patient, messages;
  try {
    [patient, messages] = await Promise.all([api.getPatient(id), api.getChatHistory(id)]);
  } catch (error) {
    if (error instanceof ApiUnavailableError) return <ApiUnavailable />;
    throw error;
  }
  if (!patient || !messages) notFound();

  return (
    <>
      <p>
        <Link href={`/patients/${encodeURIComponent(patient.id)}`}>
          ← {patient.firstName} {patient.lastName}
        </Link>
      </p>
      <div className="page-header">
        <h1>
          Chat about {patient.firstName} {patient.lastName}
        </h1>
      </div>
      <ChatTranscript messages={messages} />
      <p className="muted">Sending messages is not available yet.</p>
    </>
  );
}
