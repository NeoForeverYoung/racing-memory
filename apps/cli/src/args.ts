import { CliError } from "./errors";

/** What one command accepts. Anything else is rejected rather than ignored. */
export interface CommandSpec {
  /** Exact number of positional arguments. */
  positionals: number;
  /** Flags that take a value (`--name value` or `--name=value`). */
  valueFlags: readonly string[];
  /** Flags that never take a value. */
  booleanFlags: readonly string[];
}

export interface ParsedArguments {
  positional: string[];
  values: Map<string, string>;
  flags: Set<string>;
}

/**
 * Strict argv parser for agent callers: a typo'd flag, a stray positional, or
 * a value flag with no value is a usage error (exit 2), never silently dropped.
 */
export function parseArguments(args: readonly string[], spec: CommandSpec): ParsedArguments {
  const positional: string[] = [];
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let index = 0; index < args.length; index++) {
    const token = args[index];
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }
    const equals = token.indexOf("=");
    const name = token.slice(2, equals >= 0 ? equals : undefined);
    if (spec.booleanFlags.includes(name)) {
      if (equals >= 0) throw new CliError("INVALID_ARGUMENT", `--${name} does not take a value.`);
      flags.add(name);
      continue;
    }
    if (!spec.valueFlags.includes(name)) {
      throw new CliError("UNKNOWN_OPTION", `Unknown option: --${name}`);
    }
    const value = equals >= 0 ? token.slice(equals + 1) : args[++index];
    if (value == null || value === "" || (equals < 0 && value.startsWith("--"))) {
      throw new CliError("INVALID_ARGUMENT", `--${name} requires a value.`);
    }
    values.set(name, value);
  }
  if (positional.length > spec.positionals) {
    throw new CliError("UNEXPECTED_ARGUMENT", `Unexpected argument: ${positional[spec.positionals]}`);
  }
  return { positional, values, flags };
}

/** A numeric option, or `fallback` when absent. */
export function numberOption(args: ParsedArguments, name: string, fallback: number): number;
export function numberOption(args: ParsedArguments, name: string): number | undefined;
export function numberOption(args: ParsedArguments, name: string, fallback?: number): number | undefined {
  const raw = args.values.get(name);
  if (raw == null) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new CliError("INVALID_ARGUMENT", `--${name} must be a number.`);
  return value;
}
