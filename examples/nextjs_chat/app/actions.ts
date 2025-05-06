"use server";
import { Auth } from "@/contexts/auth";
import Postgres from "@fahren/postgres";

export interface Message {
  id: string;
  userId: string;
  content: string;
  createdAt: string;
}

export interface Channel {
  name: string;
  messages: Array<Message>;
}
const tenants = new Postgres()
  .withRlsIsolation()
  .forTenants({ poolConfig: { connectionString: process.env.DATABASE_URL } });

export async function sendMessage(
  auth: Auth,
  channelId: string,
  content: string
) {
  const { tenant } = auth;
  const { id: tenantId } = tenant;
  await tenants.queryAs(
    tenantId,
    "INSERT INTO messages (channel_id, user_id, tenant_id, content) VALUES ($1, $2, $3, $4)",
    [channelId, auth.user.id, tenantId, content]
  );
}

export async function getChannels(
  auth: Auth
): Promise<Array<{ id: string; name: string }>> {
  const { tenant } = auth;
  const { id: tenantId } = tenant;
  const { rows } = await tenants.queryAs(
    tenantId,
    "SELECT id, name FROM channels ORDER BY name"
  );
  return rows;
}

export async function getChannelById(
  auth: Auth,
  channelId: string
): Promise<Channel> {
  const { tenant } = auth;
  const { id: tenantId } = tenant;
  const nameRes = tenants.queryAs(
    tenantId,
    "SELECT name FROM channels WHERE id = $1",
    [channelId]
  );
  const { rows } = await tenants.queryAs(
    tenantId,
    "SELECT id, user_id, content, created_at FROM messages WHERE channel_id = $1 ORDER BY created_at",
    [channelId]
  );
  const { rows: nameRows } = await nameRes;
  const [{ name }] = nameRows;

  return {
    name,
    messages: rows.map((x) => ({
      id: x.id,
      content: x.content,
      userId: x.user_id,
      createdAt: x.created_at,
    })),
  };
}
