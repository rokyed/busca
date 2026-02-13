"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

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

function parseArgs(argv) {
  if (argv.length === 0) {
    return { searchRoot: "." };
  }
  if (argv.length === 1) {
    return { searchRoot: argv[0] };
  }
  fail("usage: busca [path]");
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
  fail,
  hasCommand,
  parseArgs,
  validatePath,
  ensureDependencies,
};
