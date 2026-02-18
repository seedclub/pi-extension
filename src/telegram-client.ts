/**
 * Telegram client helpers for the pi extension.
 * Handles session detection and running Python scripts via uv.
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

export const SESSION_PATH = join(homedir(), ".config", "seed-network", "telegram", "session.json");
const SCRIPTS_DIR = join(__dirname, "..", "telegram", "scripts");

export class TelegramNotConnectedError extends Error {
  constructor() {
    super("Not connected to Telegram. Run /telegram-login to authenticate.");
    this.name = "TelegramNotConnectedError";
  }
}

export interface TelegramSession {
  apiId: number;
  apiHash: string;
  phone: string;
  sessionString: string;
  authenticatedAt: string;
}

/**
 * Check if a Telegram session file exists.
 */
export function telegramSessionExists(): boolean {
  return existsSync(SESSION_PATH);
}

/**
 * Load the stored Telegram session, or null if not found.
 */
export async function loadTelegramSession(): Promise<TelegramSession | null> {
  if (!existsSync(SESSION_PATH)) return null;
  try {
    const content = await readFile(SESSION_PATH, "utf-8");
    const data = JSON.parse(content);
    if (!data.sessionString || !data.apiId || !data.apiHash) return null;
    return data as TelegramSession;
  } catch {
    return null;
  }
}

/**
 * Get the path to a Telegram script.
 */
export function getScriptPath(scriptName: string): string {
  return join(SCRIPTS_DIR, scriptName);
}

/**
 * Get the working directory for running uv scripts (where pyproject.toml lives).
 */
export function getTelegramDir(): string {
  return join(__dirname, "..", "telegram");
}

/**
 * Run a Telegram Python script via uv and parse the JSON output.
 * Returns the parsed JSON object or throws on error.
 */
export async function runTelegramScript(
  exec: (cmd: string, args: string[], opts?: { timeout?: number; cwd?: string; signal?: AbortSignal }) => Promise<{ stdout: string; stderr: string; code: number; killed: boolean }>,
  scriptName: string,
  args: string[] = [],
  options?: { timeout?: number; signal?: AbortSignal; stdin?: string }
): Promise<any> {
  const scriptPath = getScriptPath(scriptName);
  const cwd = getTelegramDir();

  // Check that uv is available before trying to run scripts
  const uvCheck = await exec("which", ["uv"], { timeout: 5000, cwd });
  if (uvCheck.code !== 0) {
    throw new Error(
      "uv (Python package manager) is not installed. " +
      "Install it with: curl -LsSf https://astral.sh/uv/install.sh | sh"
    );
  }

  const result = await exec(
    "uv",
    ["run", "--project", cwd, scriptPath, ...args],
    {
      timeout: options?.timeout ?? 30000,
      cwd,
      signal: options?.signal,
    }
  );

  if (result.killed) {
    throw new Error("Script timed out");
  }

  // Parse stdout as JSON
  const stdout = result.stdout.trim();
  if (!stdout) {
    const details = [
      result.stderr ? `stderr: ${result.stderr.slice(0, 500)}` : null,
      `exit code: ${result.code}`,
    ].filter(Boolean).join("; ");
    throw new Error(`Script produced no output (${details})`);
  }

  try {
    // Handle multi-line JSON output (login.py sends status lines before final result)
    // Take the last line that parses as JSON
    const lines = stdout.split("\n").filter(l => l.trim());
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const parsed = JSON.parse(lines[i]);
        // Check for script-level errors
        if (parsed.error) {
          const err = new Error(parsed.error);
          (err as any).code = parsed.code || "SCRIPT_ERROR";
          throw err;
        }
        return parsed;
      } catch (e) {
        if ((e as any).code) throw e; // Re-throw if it's our error
        continue; // Try next line
      }
    }
    throw new Error(`Could not parse script output as JSON: ${stdout.slice(0, 200)}`);
  } catch (e) {
    if ((e as any).code) throw e;
    throw new Error(`Invalid JSON from script: ${stdout.slice(0, 200)}`);
  }
}
