CREATE TABLE IF NOT EXISTS users (
    id uuid PRIMARY KEY,
    display_name text NOT NULL
);

CREATE TABLE IF NOT EXISTS chats (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    member_a_id uuid NOT NULL REFERENCES users (id),
    member_b_id uuid NOT NULL REFERENCES users (id),
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ordered_chat_members CHECK (member_a_id < member_b_id),
    CONSTRAINT unique_chat_pair UNIQUE (member_a_id, member_b_id)
);

CREATE INDEX IF NOT EXISTS chats_member_b_idx ON chats (member_b_id);
