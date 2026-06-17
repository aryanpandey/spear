/** Whether to show the editable confirm popup before creating extracted tasks. */
export function needsConfirm(args: { imageUsed: boolean; seedCount: number; duplicateCount: number }): boolean {
  return args.imageUsed || args.seedCount >= 2 || args.duplicateCount > 0;
}
