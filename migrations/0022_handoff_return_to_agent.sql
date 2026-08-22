ALTER TABLE conversation_events
  DROP CONSTRAINT IF EXISTS conversation_events_event_type_check;

ALTER TABLE conversation_events
  ADD CONSTRAINT conversation_events_event_type_check CHECK (event_type IN (
    'handoff_requested','assigned','assumed','transferred',
    'awaiting_customer_started','awaiting_customer_cancelled',
    'closed_human','closed_automatic','reopened','sla_warning','sla_breached',
    'promise_created','promise_completed','promise_cancelled','promise_rescheduled',
    'survey_sent','survey_answered','returned_to_agent'
  ));
