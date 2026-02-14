"use strict";

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { spawn, spawnSync } = require("child_process");

const { parseArgs, validatePath, ensureDependencies, hasCommand } = require("./cli");
const { clamp, cleanTerm, expandTabs } = require("./text");
const { fuzzyScore, highlightPositions } = require("./fuzzy");
const { truncateAnsiVisible, fitAnsiLine } = require("./ansi");
const { renderInput, framePanel } = require("./render");
const {
  RESET,
  DIM,
  CURSOR,
  CURSOR_GUTTER,
  SELECT,
  LIST_SELECTED,
} = require("./constants");

function runApp(argv = process.argv.slice(2)) {
  const { searchRoot } = parseArgs(argv);
  const root = validatePath(searchRoot);
  ensureDependencies();
  const hasBat = hasCommand("bat");

  const fileCache = new Map();
  const MAX_RG_MATCHES = 50000;
  const state = {
    root,
    focus: "rg",
    status: "Set rg term in top field, press Enter, then use fuzzy filter.",
    rgTerm: "",
    rgCursor: 0,
    fuzzyTerm: "",
    fuzzyCursor: 0,
    allMatches: [],
    filtered: [],
    selected: 0,
    listTop: 0,
    previewFile: "",
    previewLines: [""],
    previewColorLines: [""],
    previewCursorLine: 0,
    previewCursorCol: 0,
    previewPreferredCol: 0,
    previewTop: 0,
    previewAnchor: null,
    lastLayout: null,
  };
  let inAltScreen = false;
  let rgSearchSeq = 0;
  let rgProcess = null;

  function normalizePreviewRange() {
    if (!state.previewAnchor) {
      return null;
    }
    const a = { line: state.previewAnchor.line, col: state.previewAnchor.col };
    const b = { line: state.previewCursorLine, col: state.previewCursorCol };
    if (a.line > b.line || (a.line === b.line && a.col > b.col)) {
      return { start: b, end: a };
    }
    return { start: a, end: b };
  }

  function selectedPreviewText() {
    const range = normalizePreviewRange();
    if (!range) {
      return "";
    }
    const chunks = [];
    for (let i = range.start.line; i <= range.end.line; i += 1) {
      const raw = state.previewLines[i] || "";
      if (raw.length === 0) {
        chunks.push("");
        continue;
      }
      const start = i === range.start.line ? clamp(range.start.col, 0, raw.length - 1) : 0;
      const end = i === range.end.line ? clamp(range.end.col, 0, raw.length - 1) : raw.length - 1;
      if (start <= end) {
        chunks.push(raw.slice(start, end + 1));
      }
    }
    return cleanTerm(chunks.join(" "));
  }

  function currentMatch() {
    if (state.filtered.length === 0) {
      return null;
    }
    return state.filtered[clamp(state.selected, 0, state.filtered.length - 1)];
  }

  function loadFileLines(filePath) {
    const key = path.resolve(root, filePath);
    if (fileCache.has(key)) {
      return fileCache.get(key);
    }
    let plain = [""];
    let color = null;
    try {
      const content = fs.readFileSync(key, "utf8");
      plain = content.split(/\r?\n/);
      if (plain.length === 0) {
        plain = [""];
      }
    } catch {
      plain = ["[unable to read file]"];
    }

    let batAllowed = false;
    try {
      const stat = fs.statSync(key);
      batAllowed = stat.isFile() && stat.size <= 2 * 1024 * 1024;
    } catch {
      batAllowed = false;
    }

    if (hasBat && batAllowed && plain[0] !== "[unable to read file]") {
      const result = spawnSync(
        "bat",
        ["--color=always", "--style=plain", "--paging=never", "--", key],
        { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
      );
      if (!result.error && (result.status || 0) === 0) {
        color = (result.stdout || "").split(/\r?\n/);
      }
    }
    const data = { plain, color };
    fileCache.set(key, data);
    return data;
  }

  function syncPreviewFromSelected() {
    const match = currentMatch();
    if (!match) {
      state.previewFile = "";
      state.previewLines = [""];
      state.previewColorLines = [""];
      state.previewCursorLine = 0;
      state.previewCursorCol = 0;
      state.previewPreferredCol = 0;
      state.previewTop = 0;
      state.previewAnchor = null;
      return;
    }
    state.previewFile = match.file;
    const previewData = loadFileLines(match.file);
    state.previewLines = previewData.plain;
    state.previewColorLines = previewData.color || [""];
    state.previewCursorLine = clamp(match.line - 1, 0, Math.max(state.previewLines.length - 1, 0));
    const maxCol = Math.max((state.previewLines[state.previewCursorLine] || "").length - 1, 0);
    state.previewCursorCol = clamp(match.col - 1, 0, maxCol);
    state.previewPreferredCol = state.previewCursorCol;
    state.previewAnchor = null;
  }

  function applyFuzzyFilter() {
    const q = cleanTerm(state.fuzzyTerm).toLowerCase();
    if (!q) {
      state.filtered = state.allMatches.map((m) => ({ ...m, fuzzy: null }));
    } else {
      const scored = [];
      for (let i = 0; i < state.allMatches.length; i += 1) {
        const m = state.allMatches[i];
        const fuzzy = fuzzyScore(q, m.targetLower);
        if (fuzzy !== null) {
          scored.push({ m, fuzzy, idx: i });
        }
      }
      scored.sort((a, b) => {
        if (a.fuzzy.score !== b.fuzzy.score) {
          return a.fuzzy.score - b.fuzzy.score;
        }
        return a.idx - b.idx;
      });
      state.filtered = scored.map((x) => ({
        ...x.m,
        fuzzy: {
          score: x.fuzzy.score,
          positions: x.fuzzy.positions,
          gaps: x.fuzzy.gaps,
          start: x.fuzzy.start,
        },
      }));
    }
    state.selected = clamp(state.selected, 0, Math.max(state.filtered.length - 1, 0));
    state.listTop = 0;
    syncPreviewFromSelected();
  }

  function parseRgMatchLine(raw) {
    if (!raw) {
      return null;
    }
    let item;
    try {
      item = JSON.parse(raw);
    } catch {
      return null;
    }
    if (item.type !== "match" || !item.data) {
      return null;
    }
    const file = item.data.path && item.data.path.text ? item.data.path.text : "";
    if (!file) {
      return null;
    }
    const lineNo = Number(item.data.line_number || 1);
    let col = 1;
    if (Array.isArray(item.data.submatches) && item.data.submatches.length > 0) {
      col = Number(item.data.submatches[0].start || 0) + 1;
    }
    const text = String(item.data.lines && item.data.lines.text ? item.data.lines.text : "").replace(/\r?\n$/, "");
    const display = `${file}:${lineNo}:${col}: ${text}`;
    return {
      file,
      line: lineNo,
      col,
      text,
      display,
      targetLower: display.toLowerCase(),
    };
  }

  function runRgSearch(options = {}) {
    const preserveCursor = Boolean(options.preserveCursor);
    const term = cleanTerm(state.rgTerm);
    if (!preserveCursor) {
      state.rgTerm = term;
      state.rgCursor = term.length;
    }
    state.fuzzyTerm = "";
    state.fuzzyCursor = 0;
    fileCache.clear();
    state.allMatches = [];
    if (rgProcess && !rgProcess.killed) {
      rgProcess.kill("SIGTERM");
    }
    rgProcess = null;
    if (!term) {
      state.status = "RG term is empty.";
      applyFuzzyFilter();
      return;
    }

    const seq = (rgSearchSeq += 1);
    state.status = "rg searching...";
    applyFuzzyFilter();
    render();

    const child = spawn(
      "rg",
      [
        "-i",
        "--no-ignore",
        "--json",
        "--line-number",
        "--column",
        "--no-heading",
        "--color=never",
        "--",
        term,
        ".",
      ],
      { cwd: state.root, stdio: ["ignore", "pipe", "pipe"] },
    );
    rgProcess = child;

    let stdoutRemainder = "";
    let stderrText = "";
    let capped = false;

    child.stdout.on("data", (chunk) => {
      if (seq !== rgSearchSeq) {
        return;
      }
      stdoutRemainder += chunk.toString("utf8");
      let nl = stdoutRemainder.indexOf("\n");
      while (nl !== -1) {
        const raw = stdoutRemainder.slice(0, nl).replace(/\r$/, "");
        stdoutRemainder = stdoutRemainder.slice(nl + 1);
        const match = parseRgMatchLine(raw);
        if (match) {
          state.allMatches.push(match);
          if (state.allMatches.length >= MAX_RG_MATCHES) {
            capped = true;
            if (!child.killed) {
              child.kill("SIGTERM");
            }
            break;
          }
        }
        nl = stdoutRemainder.indexOf("\n");
      }
    });

    child.stderr.on("data", (chunk) => {
      if (seq !== rgSearchSeq) {
        return;
      }
      if (stderrText.length < 8192) {
        stderrText += chunk.toString("utf8");
        if (stderrText.length > 8192) {
          stderrText = stderrText.slice(0, 8192);
        }
      }
    });

    child.on("error", (err) => {
      if (seq !== rgSearchSeq) {
        return;
      }
      if (rgProcess === child) {
        rgProcess = null;
      }
      state.status = `rg failed: ${err.message}`;
      applyFuzzyFilter();
      render();
    });

    child.on("close", (code) => {
      if (seq !== rgSearchSeq) {
        return;
      }
      if (rgProcess === child) {
        rgProcess = null;
      }

      const tail = stdoutRemainder.trim();
      if (tail && !capped && state.allMatches.length < MAX_RG_MATCHES) {
        const match = parseRgMatchLine(tail);
        if (match) {
          state.allMatches.push(match);
        }
      }

      if (capped) {
        state.status = `rg matches capped at ${MAX_RG_MATCHES}`;
      } else if (![0, 1].includes(code || 0)) {
        const details = cleanTerm(stderrText);
        state.status = details || `rg exited with status ${code}`;
      } else {
        state.status = `rg matches: ${state.allMatches.length}`;
      }
      applyFuzzyFilter();
      render();
    });
  }

  function movePreviewVertical(delta) {
    if (state.previewLines.length === 0) {
      return;
    }
    state.previewCursorLine = clamp(
      state.previewCursorLine + delta,
      0,
      Math.max(state.previewLines.length - 1, 0),
    );
    const maxCol = Math.max((state.previewLines[state.previewCursorLine] || "").length - 1, 0);
    state.previewCursorCol = clamp(state.previewPreferredCol, 0, maxCol);
  }

  function movePreviewHorizontal(delta) {
    const maxCol = Math.max((state.previewLines[state.previewCursorLine] || "").length - 1, 0);
    state.previewCursorCol = clamp(state.previewCursorCol + delta, 0, maxCol);
    state.previewPreferredCol = state.previewCursorCol;
  }

  function ensureVisibleRows() {
    const layout = state.lastLayout;
    if (!layout) {
      return;
    }
    const previewBody = layout.previewBodyRows;
    if (state.previewCursorLine < state.previewTop) {
      state.previewTop = state.previewCursorLine;
    }
    if (state.previewCursorLine >= state.previewTop + previewBody) {
      state.previewTop = state.previewCursorLine - previewBody + 1;
    }
    if (state.previewTop < 0) {
      state.previewTop = 0;
    }

    if (state.selected < state.listTop) {
      state.listTop = state.selected;
    }
    if (state.selected >= state.listTop + layout.fuzzyListRows) {
      state.listTop = state.selected - layout.fuzzyListRows + 1;
    }
    if (state.listTop < 0) {
      state.listTop = 0;
    }
  }

  function lineWithSelection(index, width) {
    const raw = expandTabs(state.previewLines[index] || "");
    const clipped = raw.slice(0, Math.max(width, 0));
    const colorRaw = state.previewColorLines[index];
    const colored = colorRaw === undefined ? null : truncateAnsiVisible(expandTabs(colorRaw), Math.max(width, 0));
    const range = normalizePreviewRange();
    const cursorAt =
      index === state.previewCursorLine ? clamp(state.previewCursorCol, 0, Math.max(clipped.length - 1, 0)) : -1;

    if (clipped.length === 0) {
      return index === state.previewCursorLine ? CURSOR + " " + RESET : "";
    }

    let from = -1;
    let to = -1;
    if (range && index >= range.start.line && index <= range.end.line) {
      const startCol = index === range.start.line ? range.start.col : 0;
      const endCol = index === range.end.line ? range.end.col : clipped.length - 1;
      from = clamp(startCol, 0, clipped.length - 1);
      to = clamp(endCol, 0, clipped.length - 1);
      if (from > to) {
        from = -1;
        to = -1;
      }
    }

    const base = colored !== null ? colored : clipped;
    return applyAnsiHighlights(base, cursorAt, from, to);
  }

  function applyAnsiHighlights(baseLine, cursorAt, from, to) {
    let out = "";
    let visible = 0;
    let i = 0;
    let activeSgr = "";
    while (i < baseLine.length) {
      if (baseLine[i] === "\x1b" && baseLine[i + 1] === "[") {
        let j = i + 2;
        while (j < baseLine.length && baseLine[j] !== "m") {
          j += 1;
        }
        if (j < baseLine.length) {
          j += 1;
        }
        const seq = baseLine.slice(i, j);
        out += seq;
        if (/\x1b\[0?m$/.test(seq)) {
          activeSgr = "";
        } else if (seq.endsWith("m")) {
          activeSgr = seq;
        }
        i = j;
        continue;
      }
      const ch = baseLine[i];
      const inSelection = from !== -1 && visible >= from && visible <= to;
      const isCursor = visible === cursorAt;
      if (isCursor) {
        out += CURSOR + ch + RESET + activeSgr;
      } else if (inSelection) {
        out += SELECT + ch + RESET + activeSgr;
      } else {
        out += ch;
      }
      i += 1;
      visible += 1;
    }
    return out;
  }

  function buildSelectedFileTreeLines() {
    const rootName = path.basename(state.root) || state.root || ".";
    if (!state.previewFile) {
      return [DIM + rootName + RESET, "(no file selected)"];
    }
    const parts = state.previewFile.replace(/\\/g, "/").split("/").filter(Boolean);
    const lines = [DIM + rootName + RESET];
    let indent = "";
    for (let i = 0; i < parts.length; i += 1) {
      const label = `${indent}\`-- ${parts[i]}`;
      lines.push(i === parts.length - 1 ? LIST_SELECTED + label + RESET : label);
      indent += "    ";
    }
    return lines;
  }

  function combinePanels(leftLines, leftWidth, rightLines, rightWidth) {
    const rows = Math.max(leftLines.length, rightLines.length);
    const out = [];
    for (let i = 0; i < rows; i += 1) {
      const left = i < leftLines.length ? leftLines[i] : "";
      const right = i < rightLines.length ? rightLines[i] : "";
      out.push(`${fitAnsiLine(left, leftWidth)} ${fitAnsiLine(right, rightWidth)}`);
    }
    return out;
  }

  function layoutFor(rows) {
    const total = Math.max(rows, 10);
    const previewStaticRows = 1;
    const fuzzyStaticRows = 3;
    const rgContentRows = 1;
    const borderRows = 6;

    let previewBodyRows = 6;
    let fuzzyListRows = 4;

    const used = borderRows + previewStaticRows + fuzzyStaticRows + rgContentRows + previewBodyRows + fuzzyListRows;
    if (used < total) {
      const extra = total - used;
      const previewExtra = Math.floor(extra * 0.65);
      previewBodyRows += previewExtra;
      fuzzyListRows += extra - previewExtra;
    } else if (used > total) {
      let reduce = used - total;
      while (reduce > 0 && previewBodyRows > 2) {
        previewBodyRows -= 1;
        reduce -= 1;
      }
      while (reduce > 0 && fuzzyListRows > 1) {
        fuzzyListRows -= 1;
        reduce -= 1;
      }
      while (reduce > 0 && previewBodyRows > 1) {
        previewBodyRows -= 1;
        reduce -= 1;
      }
    }

    return { previewBodyRows, fuzzyListRows };
  }

  function render() {
    const rows = process.stdout.rows || 28;
    const cols = process.stdout.columns || 100;
    state.lastLayout = layoutFor(rows);
    ensureVisibleRows();
    const panelWidth = Math.max(cols, 20);
    const innerWidth = panelWidth - 2;

    const out = [];
    out.push("\x1b[?25l\x1b[2J\x1b[H");

    const rgFocus = state.focus === "rg" ? "ACTIVE" : "";
    const rgLines = [
      renderInput("rg> ", state.rgTerm, state.rgCursor, state.focus === "rg", innerWidth),
    ];
    out.push(...framePanel(`RG ${rgFocus} | Enter run rg -i`, rgLines, panelWidth, state.focus === "rg"));

    const fuzzyFocus = state.focus === "fzf" ? "ACTIVE" : "";
    const fuzzyLines = [];
    fuzzyLines.push(
      DIM + `status: ${state.status} | visible: ${state.filtered.length}/${state.allMatches.length}` + RESET,
    );
    fuzzyLines.push(renderInput("fuzzy> ", state.fuzzyTerm, state.fuzzyCursor, state.focus === "fzf", innerWidth));
    const selectedMatch = currentMatch();
    if (selectedMatch && selectedMatch.fuzzy) {
      const why = `why: subsequence start=${selectedMatch.fuzzy.start} gaps=${selectedMatch.fuzzy.gaps} score=${selectedMatch.fuzzy.score.toFixed(3)}`;
      fuzzyLines.push(DIM + truncateAnsiVisible(why, innerWidth) + RESET);
    } else if (cleanTerm(state.fuzzyTerm)) {
      fuzzyLines.push(DIM + "why: type to match file:line:text by ordered characters" + RESET);
    }
    for (let row = 0; row < state.lastLayout.fuzzyListRows; row += 1) {
      const idx = state.listTop + row;
      if (idx >= state.filtered.length) {
        fuzzyLines.push(DIM + "~" + RESET);
        continue;
      }
      const prefix = idx === state.selected ? "> " : "  ";
      const item = state.filtered[idx];
      let line = `${prefix}${item.display}`;
      if (item.fuzzy && item.fuzzy.positions.length > 0) {
        const shifted = item.fuzzy.positions.map((p) => p + prefix.length);
        line = highlightPositions(line, shifted);
      }
      if (item.fuzzy) {
        const reason = DIM + ` [s:${item.fuzzy.start} g:${item.fuzzy.gaps}]` + RESET;
        line += reason;
      }
      line = truncateAnsiVisible(line, innerWidth);
      if (idx === state.selected) {
        fuzzyLines.push(LIST_SELECTED + line + RESET);
      } else {
        fuzzyLines.push(line);
      }
    }
    out.push(
      ...framePanel(
        `Fuzzy ${fuzzyFocus} | Up/Down select | Enter preview | matches file:line:text`,
        fuzzyLines,
        panelWidth,
        state.focus === "fzf",
      ),
    );

    const previewFocus = state.focus === "preview" ? "ACTIVE" : "";
    const treeLines = buildSelectedFileTreeLines();

    const bottomTotalWidth = panelWidth;
    const leftPanelWidth = clamp(Math.floor((bottomTotalWidth - 1) * 0.68), 30, Math.max(30, bottomTotalWidth - 24));
    const rightPanelWidth = Math.max(bottomTotalWidth - 1 - leftPanelWidth, 20);

    const previewLines = [];
    previewLines.push(
      DIM +
        `file: ${state.previewFile || "(none)"}  cursor: ${state.previewCursorLine + 1}:${state.previewCursorCol + 1}` +
        RESET,
    );
    const previewInnerWidth = Math.max(leftPanelWidth - 2, 10);
    const contentWidth = previewInnerWidth;
    const numberWidth = String(Math.max(state.previewLines.length, 1)).length;
    for (let row = 0; row < state.lastLayout.previewBodyRows; row += 1) {
      const idx = state.previewTop + row;
      let contentLine = "~";
      if (idx < state.previewLines.length) {
        const marker = idx === state.previewCursorLine ? ">" : " ";
        const lno = String(idx + 1).padStart(numberWidth, " ");
        const plainPrefix = `${marker} ${lno} `;
        const prefix = idx === state.previewCursorLine ? CURSOR_GUTTER + plainPrefix + RESET : plainPrefix;
        const width = Math.max(contentWidth - plainPrefix.length, 0);
        contentLine = prefix + lineWithSelection(idx, width);
      }
      previewLines.push(contentLine);
    }

    const treePanelLines = [];
    treePanelLines.push(DIM + `selected: ${state.previewFile || "(none)"}` + RESET);
    for (let row = 0; row < state.lastLayout.previewBodyRows; row += 1) {
      treePanelLines.push(row < treeLines.length ? treeLines[row] : DIM + "~" + RESET);
    }

    const previewPanel = framePanel(
      `Preview ${previewFocus} | hjkl/arrows move | v select | Esc clear | Enter set rg`,
      previewLines,
      leftPanelWidth,
      state.focus === "preview",
    );
    const treePanel = framePanel(
      "File Tree",
      treePanelLines,
      rightPanelWidth,
      false,
    );
    out.push(...combinePanels(previewPanel, leftPanelWidth, treePanel, rightPanelWidth));

    process.stdout.write(out.slice(0, rows).join("\n"));
  }

  function cycleFocus() {
    if (state.focus === "rg") {
      state.focus = "fzf";
    } else if (state.focus === "fzf") {
      state.focus = "preview";
    } else {
      state.focus = "rg";
    }
  }

  function handleFieldInput(kind, str, key) {
    const isRg = kind === "rg";
    const textKey = isRg ? "rgTerm" : "fuzzyTerm";
    const cursorKey = isRg ? "rgCursor" : "fuzzyCursor";
    const text = state[textKey];
    const cursor = state[cursorKey];

    if (key.name === "backspace") {
      if (cursor > 0) {
        state[textKey] = text.slice(0, cursor - 1) + text.slice(cursor);
        state[cursorKey] = cursor - 1;
        if (!isRg) {
          applyFuzzyFilter();
        }
      }
      return;
    }
    if (key.ctrl && key.name === "u") {
      state[textKey] = "";
      state[cursorKey] = 0;
      if (!isRg) {
        applyFuzzyFilter();
      }
      return;
    }
    if (key.name === "left") {
      state[cursorKey] = Math.max(cursor - 1, 0);
      return;
    }
    if (key.name === "right") {
      state[cursorKey] = Math.min(cursor + 1, text.length);
      return;
    }
    if (key.name === "home") {
      state[cursorKey] = 0;
      return;
    }
    if (key.name === "end") {
      state[cursorKey] = text.length;
      return;
    }
    if (str && !key.ctrl && !key.meta && str >= " ") {
      state[textKey] = text.slice(0, cursor) + str + text.slice(cursor);
      state[cursorKey] = cursor + str.length;
      if (!isRg) {
        applyFuzzyFilter();
      }
    }
  }

  function cleanup() {
    if (rgProcess && !rgProcess.killed) {
      rgProcess.kill("SIGTERM");
      rgProcess = null;
    }
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    if (inAltScreen) {
      process.stdout.write("\x1b[0m\x1b[?25h\x1b[?1049l");
      inAltScreen = false;
    } else {
      process.stdout.write("\x1b[0m\x1b[?25h\n");
    }
  }

  process.on("exit", cleanup);
  process.on("SIGINT", () => process.exit(130));
  process.on("SIGTERM", () => process.exit(143));
  process.stdout.on("resize", render);

  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }
  if (process.stdout.isTTY) {
    process.stdout.write("\x1b[?1049h\x1b[2J\x1b[H");
    inAltScreen = true;
  }
  process.stdin.resume();

  process.stdin.on("keypress", (str, key) => {
    if (!key) {
      return;
    }
    if (key.ctrl && key.name === "c") {
      process.exit(130);
      return;
    }
    if (key.name === "tab") {
      cycleFocus();
      render();
      return;
    }

    if (state.focus === "preview") {
      if (key.name === "escape") {
        if (state.previewAnchor) {
          state.previewAnchor = null;
        }
        render();
        return;
      }
      if (key.name === "up" || str === "k") {
        movePreviewVertical(-1);
        render();
        return;
      }
      if (key.name === "down" || str === "j") {
        movePreviewVertical(1);
        render();
        return;
      }
      if (key.name === "left" || str === "h") {
        movePreviewHorizontal(-1);
        render();
        return;
      }
      if (key.name === "right" || str === "l") {
        movePreviewHorizontal(1);
        render();
        return;
      }
      if (str === "v" && !key.ctrl && !key.meta) {
        state.previewAnchor = state.previewAnchor
          ? null
          : { line: state.previewCursorLine, col: state.previewCursorCol };
        render();
        return;
      }
      if (key.name === "return") {
        if (state.previewAnchor) {
          const text = selectedPreviewText();
          if (text) {
            state.rgTerm = text;
            state.rgCursor = text.length;
            runRgSearch();
            state.focus = "fzf";
          }
          state.previewAnchor = null;
          render();
        }
        return;
      }
      return;
    }

    if (state.focus === "fzf") {
      if (key.name === "up") {
        state.selected = clamp(state.selected - 1, 0, Math.max(state.filtered.length - 1, 0));
        syncPreviewFromSelected();
        render();
        return;
      }
      if (key.name === "down") {
        state.selected = clamp(state.selected + 1, 0, Math.max(state.filtered.length - 1, 0));
        syncPreviewFromSelected();
        render();
        return;
      }
      if (key.name === "return") {
        state.focus = "preview";
        render();
        return;
      }
      handleFieldInput("fzf", str, key);
      render();
      return;
    }

    if (state.focus === "rg") {
      if (key.name === "return") {
        runRgSearch();
        state.focus = "fzf";
        render();
        return;
      }
      handleFieldInput("rg", str, key);
      render();
    }
  });

  runRgSearch();
  render();
}

module.exports = {
  runApp,
};
