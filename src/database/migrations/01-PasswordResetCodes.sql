-- PASSWORD RESET CODES
CREATE TABLE password_reset_codes (
  id         BIGSERIAL    PRIMARY KEY,
  user_id    INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash  TEXT         NOT NULL,
  expires_at TIMESTAMPTZ  NOT NULL,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  used_at    TIMESTAMPTZ  NULL
);

CREATE INDEX idx_password_reset_codes_user_id ON password_reset_codes(user_id);
