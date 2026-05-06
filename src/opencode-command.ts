#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCli } from "./cli.js";
import { toSafeErrorMessage, UserFacingError } from "./errors.js";
import { appendDebugLog } from "./log.js";
import { getRuntimePaths } from "./paths.js";

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const paths = getRuntimePaths();

  try {
    const rawArguments = await readStdin();
    await appendDebugLog(paths, "legacy command invoked", [`arguments: ${summarizeArguments(rawArguments)}`]);

    const result = await runCli(parseArgumentLine(rawArguments));
    await appendDebugLog(paths, result.code === 0 ? "legacy command completed" : "legacy command failed", [
      `exitCode: ${result.code}`,
      result.stderr ? `error: ${result.stderr}` : "error: none",
    ]);

    if (result.stdout) process.stdout.write(`${result.stdout}\n`);
    if (result.stderr) process.stdout.write(`Error: ${result.stderr}\n`);
    if (result.code !== 0) process.stdout.write(`\n(opencode-as exited with code ${result.code})\n`);
  } catch (error) {
    await appendDebugLog(paths, "legacy command crashed", [`error: ${toSafeErrorMessage(error)}`]);
    process.stdout.write(`Error: ${toSafeErrorMessage(error)}\n`);
    process.stdout.write("\n(opencode-as exited with code 1)\n");
  }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8").trim();
}

export function parseArgumentLine(input: string): string[] {
  if (!input.trim()) return [];

  const args: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];

    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        args.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (quote) throw new UserFacingError("Unclosed quote in command arguments.");
  if (current) args.push(current);
  return args;
}

function summarizeArguments(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "<empty>";
  return trimmed.length > 200 ? `${trimmed.slice(0, 200)}...` : trimmed;
}
