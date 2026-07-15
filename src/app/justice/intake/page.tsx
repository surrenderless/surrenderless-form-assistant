import { redirect } from "next/navigation";
import { JUSTICE_CHAT_ONLY_ENTRY_PATH } from "@/lib/justice/chatOnlyEntryPaths";

/** Legacy structured form intake — normal users enter only via /justice/chat-ai. */
export default function JusticeIntakePage() {
  redirect(JUSTICE_CHAT_ONLY_ENTRY_PATH);
}
