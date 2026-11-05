export function parseDurationSeconds(raw: string): number {
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h)?$/i.exec(raw.trim());
  if (!match) throw new Error(`Invalid duration: ${raw}`);
  const value = Number(match[1]);
  const unit = (match[2] ?? "s").toLowerCase();
  const multiplier = unit === "ms" ? 0.001 : unit === "m" ? 60 : unit === "h" ? 3600 : 1;
  return value * multiplier;
}
