"use strict";

const { CURSOR, PANEL_ACTIVE, PANEL_INACTIVE, RESET } = require("./constants");
const { fitAnsiLine } = require("./ansi");

function renderInput(label, text, cursor, active, width) {
  const prefix = label;
  const available = Math.max(width - prefix.length, 1);
  let start = 0;
  if (active && cursor >= available) {
    start = cursor - available + 1;
  } else if (!active && text.length > available) {
    start = text.length - available;
  }
  const visible = text.slice(start, start + available);
  if (!active) {
    return (prefix + visible).slice(0, width);
  }

  const at = cursor - start;
  if (at < 0 || at >= available) {
    return (prefix + visible).slice(0, width);
  }
  const ch = at < visible.length ? visible[at] : " ";
  const out = prefix + visible.slice(0, at) + CURSOR + ch + RESET + visible.slice(at + 1);
  return out.slice(0, width + 32);
}

function framePanel(title, lines, width, active) {
  const inner = Math.max(width - 2, 1);
  let caption = ` ${title} `;
  if (caption.length > inner) {
    caption = caption.slice(0, inner);
  }
  const border = active ? PANEL_ACTIVE : PANEL_INACTIVE;
  const top = `${border}+${caption}${"-".repeat(Math.max(inner - caption.length, 0))}+${RESET}`;
  const body = lines.map((line) => `${border}|${RESET}${fitAnsiLine(line, inner)}${border}|${RESET}`);
  const bottom = `${border}+${"-".repeat(inner)}+${RESET}`;
  return [top, ...body, bottom];
}

module.exports = {
  renderInput,
  framePanel,
};

