CREATE TABLE IF NOT EXISTS conversation_reason_catalog (
  id text PRIMARY KEY,
  category text NOT NULL CHECK (category IN ('handoff','human_closure','automatic_closure')),
  label text NOT NULL CHECK (char_length(btrim(label)) BETWEEN 2 AND 120),
  active boolean NOT NULL DEFAULT true,
  system_default boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS conversation_reason_catalog_category_active_idx
  ON conversation_reason_catalog(category, active, sort_order, label);

INSERT INTO conversation_reason_catalog (id, category, label, system_default, sort_order)
VALUES
  ('customer_requested_human', 'handoff', 'Cliente pediu atendimento humano', true, 10),
  ('scheduling_request', 'handoff', 'Marcação ou alteração de horário', true, 20),
  ('clinical_safety', 'handoff', 'Avaliação humana por segurança', true, 30),
  ('financial_request', 'handoff', 'Solicitação financeira', true, 40),
  ('automation_failure', 'handoff', 'Falha do atendimento automático', true, 50),
  ('media_requires_human', 'handoff', 'Mídia precisa de atendimento humano', true, 60),
  ('other_handoff', 'handoff', 'Outro motivo', true, 90),
  ('resolved', 'human_closure', 'Necessidade resolvida', true, 10),
  ('scheduled', 'human_closure', 'Agendamento concluído', true, 20),
  ('guidance_completed', 'human_closure', 'Orientação concluída', true, 30),
  ('client_withdrew', 'human_closure', 'Cliente desistiu', true, 40),
  ('duplicate', 'human_closure', 'Atendimento duplicado', true, 50),
  ('service_unavailable', 'human_closure', 'Atendimento não disponível', true, 60),
  ('follow_up_later', 'human_closure', 'Cliente retornará depois', true, 70),
  ('other_human_closure', 'human_closure', 'Outro motivo', true, 90),
  ('customer_inactivity', 'automatic_closure', 'Inatividade do cliente', true, 10),
  ('customer_satisfied', 'automatic_closure', 'Cliente satisfeito e autorizou encerrar', true, 20),
  ('technical_duplicate', 'automatic_closure', 'Duplicidade técnica', true, 30)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS handoff_reason_id text REFERENCES conversation_reason_catalog(id),
  ADD COLUMN IF NOT EXISTS closure_reason_id text REFERENCES conversation_reason_catalog(id),
  ADD COLUMN IF NOT EXISTS closure_note text,
  ADD COLUMN IF NOT EXISTS closure_origin text CHECK (closure_origin IS NULL OR closure_origin IN ('human','automatic')),
  ADD COLUMN IF NOT EXISTS closed_by_user_id text,
  ADD COLUMN IF NOT EXISTS reopened_from_conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS last_human_actor_user_id text,
  ADD COLUMN IF NOT EXISTS last_human_actor_label text,
  ADD COLUMN IF NOT EXISTS awaiting_customer_since timestamptz,
  ADD COLUMN IF NOT EXISTS inactivity_token text;

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS actor_user_id text,
  ADD COLUMN IF NOT EXISTS actor_label text;

CREATE TABLE IF NOT EXISTS conversation_views (
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  viewer_user_id text NOT NULL,
  last_viewed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, viewer_user_id)
);

CREATE INDEX IF NOT EXISTS conversation_views_viewer_idx
  ON conversation_views(viewer_user_id, last_viewed_at DESC);

CREATE TABLE IF NOT EXISTS conversation_operation_settings (
  id text PRIMARY KEY CHECK (id = 'default'),
  automatic_inactivity_enabled boolean NOT NULL DEFAULT false,
  customer_inactivity_minutes integer NOT NULL DEFAULT 60
    CHECK (customer_inactivity_minutes BETWEEN 5 AND 10080),
  updated_by_user_id text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO conversation_operation_settings (id) VALUES ('default')
ON CONFLICT (id) DO NOTHING;
