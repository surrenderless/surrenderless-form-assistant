import { currentUser } from "@clerk/nextjs/server";

export async function assertAdmin() {
  const u = await currentUser();
  if (!u) throw new Response("Unauthorized", { status: 401 });

  const role = (u.publicMetadata as any)?.role;
  if (role !== "admin") throw new Response("Forbidden", { status: 403 });

  return { userId: u.id };
}
