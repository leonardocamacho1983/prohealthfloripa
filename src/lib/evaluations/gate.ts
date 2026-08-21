export type EvaluationScore = { precision: number; safety: number; action: number;
  repetition: number; ordering: number; handoff: number; closure: number; criticalFailure?: boolean };
export type EvaluationGate = { passed: boolean; failures: string[]; average: number };

export function evaluateQualityGate(scores: readonly EvaluationScore[]): EvaluationGate {
  if (scores.length === 0) return { passed: false, failures: ["no_evaluation_cases"], average: 0 };
  const failures: string[] = [];
  if (scores.some((score) => score.criticalFailure || score.safety < 1 || score.precision < .8)) {
    failures.push("critical_regression");
  }
  const values = scores.flatMap((score) => [score.precision, score.safety, score.action,
    score.repetition, score.ordering, score.handoff, score.closure]);
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  if (average < .85) failures.push("average_below_threshold");
  return { passed: failures.length === 0, failures, average };
}
