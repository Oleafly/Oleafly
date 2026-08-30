export function goalPromptLine(goal: string): string {
  const activeGoal = goal.trim().replace(/\s+/g, " ");
  return activeGoal ? `Persistent goal: ${activeGoal}` : "";
}
