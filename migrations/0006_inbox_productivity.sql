CREATE TABLE IF NOT EXISTS inbox_internal_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  author_label text NOT NULL DEFAULT 'Equipe',
  content text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inbox_internal_notes_conversation_created_idx
  ON inbox_internal_notes(conversation_id, created_at DESC);

CREATE TABLE IF NOT EXISTS inbox_quick_replies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shortcut text NOT NULL UNIQUE,
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 60),
  content text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 1500),
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO inbox_quick_replies (shortcut, label, content, sort_order)
VALUES
  ('saudacao', 'Saudação', 'Olá! Como posso ajudar você hoje?', 10),
  ('confirmacao', 'Vou confirmar', 'Só um instante, por favor. Vou confirmar essa informação para você.', 20),
  ('encerramento', 'Encerramento', 'Obrigada pelo contato! Se precisar de algo mais, estou por aqui.', 30)
ON CONFLICT (shortcut) DO NOTHING;
