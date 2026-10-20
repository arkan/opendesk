-- A browser that receives web pushes (contracts/native.md "Web Push"). Like a phone in
-- push_devices, it lives exactly as long as the session that subscribed it. The endpoint
-- is hashed for lookup, and the endpoint and keys are sealed for sending.
CREATE TABLE web_push_subscriptions (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_id    uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    endpoint_hash bytea NOT NULL UNIQUE,
    sealed        bytea NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    last_push_at  timestamptz
);
CREATE INDEX web_push_subscriptions_user_idx ON web_push_subscriptions(user_id);
CREATE INDEX web_push_subscriptions_session_idx ON web_push_subscriptions(session_id);
