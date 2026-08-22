export async function generateReplyWithFallback<TInput, TOutput>({
  input,
  primary,
  fallback,
  onPrimaryFailure,
}: {
  input: TInput;
  primary: (input: TInput) => Promise<TOutput>;
  fallback: (input: TInput) => Promise<TOutput>;
  onPrimaryFailure?: (error: unknown) => void;
}): Promise<TOutput> {
  try {
    return await primary(input);
  } catch (error) {
    onPrimaryFailure?.(error);
    return fallback(input);
  }
}
