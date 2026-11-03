import { redirect } from "next/navigation";

import { api } from "@/lib/api-client";
import { homePath } from "@/lib/session";

/** The patients list for doctors, their own dashboard for patients. */
export default async function Home(): Promise<never> {
  const session = await api.getSession().catch(() => undefined);
  redirect(homePath(session?.user));
}
