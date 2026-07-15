import { redirect } from "next/navigation";
import { JUSTICE_CHAT_ONLY_ENTRY_PATH } from "@/lib/justice/chatOnlyEntryPaths";

/** Legacy scripted chat — normal users enter only via /justice/chat-ai. */
export default function JusticeChatPage() {
  redirect(JUSTICE_CHAT_ONLY_ENTRY_PATH);
}
