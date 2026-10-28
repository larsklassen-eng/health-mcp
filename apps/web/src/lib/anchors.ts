/** The anchor of a chat message in the transcript, e.g. "message-m1". */
export const messageAnchor = (messageId: string) => `message-${messageId}`;

/** The anchor of a symptom on the patient's dashboard, e.g. "symptom-s1". */
export const symptomAnchor = (symptomId: string) => `symptom-${symptomId}`;
