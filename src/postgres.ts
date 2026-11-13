import { Pool } from "pg";
import { databaseUrl } from "./config";
import { ApiError } from "./errors";

interface ChatRow {
  id: string;
  member_a_id: string;
  member_b_id: string;
}

export interface Chat {
  chatId: string;
  memberIds: [string, string];
}

function toChat(row: ChatRow): Chat {
  return { chatId: row.id, memberIds: [row.member_a_id, row.member_b_id] };
}

export function openPool(): Pool {
  const pool = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 5_000 });
  pool.on("error", (error) => console.error("Idle PostgreSQL connection failed", error));
  return pool;
}

export class PostgresChats {
  constructor(private readonly pool: Pool) {}

  async create(userAId: string, userBId: string): Promise<string> {
    if (userAId === userBId) {
      throw new ApiError(400, "A chat requires two distinct users");
    }

    try {
      const { rows } = await this.pool.query<{ id: string }>(
        `INSERT INTO chats (member_a_id, member_b_id)
         VALUES (LEAST($1::uuid, $2::uuid), GREATEST($1::uuid, $2::uuid))
         ON CONFLICT (member_a_id, member_b_id)
         DO UPDATE SET member_a_id = EXCLUDED.member_a_id
         RETURNING id`,
        [userAId, userBId],
      );
      const chat = rows[0];
      if (!chat) throw new Error("Chat insert returned no row");
      return chat.id;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "23503") {
        throw new ApiError(404, "One or both users do not exist");
      }
      throw error;
    }
  }

  async get(chatId: string): Promise<Chat> {
    const { rows } = await this.pool.query<ChatRow>(
      "SELECT id, member_a_id, member_b_id FROM chats WHERE id = $1",
      [chatId],
    );
    const chat = rows[0];
    if (!chat) throw new ApiError(404, "Chat not found");
    return toChat(chat);
  }

  async list(userId: string): Promise<Chat[]> {
    const user = await this.pool.query("SELECT id FROM users WHERE id = $1", [userId]);
    if (!user.rows[0]) throw new ApiError(404, "User not found");

    const { rows } = await this.pool.query<ChatRow>(
      `SELECT id, member_a_id, member_b_id
       FROM chats WHERE member_a_id = $1 OR member_b_id = $1
       ORDER BY created_at DESC, id DESC`,
      [userId],
    );
    return rows.map(toChat);
  }
}
