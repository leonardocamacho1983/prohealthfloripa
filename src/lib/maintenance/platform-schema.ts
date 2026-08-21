import "server-only";
import { ensureConversationRuntimeSchema } from "@/lib/conversations/neon-repository";
import { ensureConversationWorkflowSchema } from "@/lib/conversations/workflow-schema";
import { ensureNotificationDeliverySchema } from "@/lib/notifications/delivery-schema";
import { ensureFeatureFlagSchema } from "@/lib/feature-flags/repository";
import { ensureSlaSchema } from "@/lib/sla/repository";
import { ensureCxSchema } from "@/lib/cx/schema";
import { ensurePromiseSchema } from "@/lib/promises/repository";
import { ensureKnowledgeGovernanceSchema } from "@/lib/knowledge/governance";
import { ensureEvaluationSchema } from "@/lib/evaluations/repository";
import { ensureWorkforceSchema } from "@/lib/attendants/workforce";

export const PLATFORM_SCHEMA_VERSION = 20;

export async function ensurePlatformSchema(): Promise<void> {
  await ensureConversationRuntimeSchema();
  await ensureConversationWorkflowSchema();
  await ensureFeatureFlagSchema();
  await ensureNotificationDeliverySchema();
  await ensureSlaSchema();
  await ensureCxSchema();
  await ensurePromiseSchema();
  await ensureKnowledgeGovernanceSchema();
  await ensureEvaluationSchema();
  await ensureWorkforceSchema();
}
