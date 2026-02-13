"use strict";

const { RESET } = require("./constants");

function stripAnsi(value) {
  return String(value || "").replace(/\x1b\[[0-9;]*m/g, "");
}

function truncateAnsiVisible(value, maxVisible) {
  if (maxVisible <= 0) {
    return "";
  }
  let out = "";
  let visible = 0;
  for (let i = 0; i < value.length && visible < maxVisible; ) {
    if (value[i] === "\x1b" && value[i + 1] === "[") {
      let j = i + 2;
      while (j < value.length && value[j] !== "m") {
        j += 1;
      }
      if (j < value.length) {
        j += 1;
      }
      out += value.slice(i, j);
      i = j;
      continue;
    }
    out += value[i];
    i += 1;
    visible += 1;
  }
  if (out.includes("\x1b[")) {
    out += RESET;
  }
  return out;
}

function fitAnsiLine(value, width) {
  let out = String(value || "");
  const visible = stripAnsi(out).length;
  if (visible > width) {
    out = truncateAnsiVisible(out, width);
  }
  const newVisible = stripAnsi(out).length;
  if (newVisible < width) {
    out += " ".repeat(width - newVisible);
  }
  return out;
}

module.exports = {
  stripAnsi,
  truncateAnsiVisible,
  fitAnsiLine,
};

