"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const DEFAULT_MAX_RESULTS = 50000;
const DEFAULT_MAX_BAT_BYTES = 2 * 1024 * 1024;

function fail(message, exitCode = 1) {
  console.error(`busca: ${message}`);
  process.exit(exitCode);
}

function hasCommand(cmd) {
  const result = spawnSync("bash", ["-lc", `command -v ${cmd}`], {
    encoding: "utf8",
  });
  return result.status === 0;
}

function printHelp() {
  const help = [
    "busca - terminal search TUI",
    "",
    "Usage:",
    "  busca [path] [options]",
    "  busca -h | --help",
    "",
    "Arguments:",
    "  path        Root directory where searches run (default: current directory).",
    "",
    "Options:",
    "  --max-results N     Maximum rg matches to keep in memory",
    `                      (default: ${DEFAULT_MAX_RESULTS}).`,
    "  --max-bat-bytes N   Maximum file size (bytes) to syntax-highlight with bat",
    `                      (default: ${DEFAULT_MAX_BAT_BYTES}).`,
    "",
    "Behavior:",
    "  - rg search is case-insensitive and runs with --no-ignore.",
    "  - one rg input searches both content and file names at the same time.",
    "  - press Enter in rg field to run search.",
    "  - fuzzy field narrows matches by file:line:text.",
    "",
    "Panels and keys:",
    "  - Tab: switch active panel",
    "  - Fuzzy list: Up/Down to move selected match, Enter to focus preview",
    "  - Preview: arrows/hjkl move cursor, v toggles selection, Esc clears selection",
    "  - Preview + selection + Enter: use selected text as next rg term",
    "",
    "Dependencies:",
    "  - required: rg (ripgrep)",
    "  - optional: bat (syntax-highlighted preview)",
  ].join("\n");
  process.stdout.write(`${help}\n`);
}

function parsePositiveInt(value, optionName) {
  const num = Number(value);
  if (!Number.isFinite(num) || !Number.isInteger(num) || num <= 0) {
    fail(`${optionName} must be a positive integer`);
  }
  return num;
}

function parseArgs(argv) {
  const positional = [];
  let maxResults = DEFAULT_MAX_RESULTS;
  let maxBatBytes = DEFAULT_MAX_BAT_BYTES;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      printHelp();
      process.exit(0);
    }
    if (arg === "--max-results") {
      if (i + 1 >= argv.length) {
        fail("--max-results requires a value");
      }
      i += 1;
      maxResults = parsePositiveInt(argv[i], "--max-results");
      continue;
    }
    if (arg.startsWith("--max-results=")) {
      maxResults = parsePositiveInt(arg.slice("--max-results=".length), "--max-results");
      continue;
    }
    if (arg === "--max-bat-bytes") {
      if (i + 1 >= argv.length) {
        fail("--max-bat-bytes requires a value");
      }
      i += 1;
      maxBatBytes = parsePositiveInt(argv[i], "--max-bat-bytes");
      continue;
    }
    if (arg.startsWith("--max-bat-bytes=")) {
      maxBatBytes = parsePositiveInt(arg.slice("--max-bat-bytes=".length), "--max-bat-bytes");
      continue;
    }
    if (arg.startsWith("-")) {
      fail(`unknown option: ${arg}`);
    }
    positional.push(arg);
  }

  if (positional.length > 1) {
    fail("usage: busca [path] [--max-results N] [--max-bat-bytes N]");
  }
  return {
    searchRoot: positional[0] || ".",
    maxResults,
    maxBatBytes,
  };
}

function validatePath(searchRoot) {
  const absolute = path.resolve(searchRoot);
  if (!fs.existsSync(absolute)) {
    fail(`path does not exist: ${searchRoot}`);
  }
  if (!fs.statSync(absolute).isDirectory()) {
    fail(`path is not a directory: ${searchRoot}`);
  }
  return absolute;
}

function ensureDependencies() {
  const required = ["rg"];
  const missing = required.filter((cmd) => !hasCommand(cmd));
  if (missing.length > 0) {
    fail(`missing required commands: ${missing.join(", ")}`);
  }
}

module.exports = {
  DEFAULT_MAX_RESULTS,
  DEFAULT_MAX_BAT_BYTES,
  fail,
  hasCommand,
  printHelp,
  parseArgs,
  validatePath,
  ensureDependencies,
};
