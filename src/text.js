"use strict";

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function cleanTerm(value) {
  return String(value || "")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function expandTabs(value) {
  return value.replace(/\t/g, "  ");
}

module.exports = {
  clamp,
  cleanTerm,
  expandTabs,
};

