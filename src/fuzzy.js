"use strict";

const { FUZZY_MATCH, RESET } = require("./constants");

function fuzzyScore(queryLower, textLower) {
  if (!queryLower) {
    return { score: 0, positions: [], gaps: 0, start: 0 };
  }
  let score = 0;
  let pos = 0;
  let last = -1;
  let gaps = 0;
  const positions = [];
  for (const ch of queryLower) {
    const found = textLower.indexOf(ch, pos);
    if (found === -1) {
      return null;
    }
    positions.push(found);
    if (last === -1) {
      score += found * 0.2;
    } else {
      const gap = found - last - 1;
      score += gap;
      gaps += gap;
      if (gap === 0) {
        score -= 0.7;
      }
    }
    last = found;
    pos = found + 1;
  }
  score += textLower.length * 0.001;
  return {
    score,
    positions,
    gaps,
    start: positions.length > 0 ? positions[0] + 1 : 0,
  };
}

function highlightPositions(text, positions) {
  if (!positions || positions.length === 0) {
    return text;
  }
  const marks = new Set(positions);
  let out = "";
  for (let i = 0; i < text.length; i += 1) {
    if (marks.has(i)) {
      out += FUZZY_MATCH + text[i] + RESET;
    } else {
      out += text[i];
    }
  }
  return out;
}

module.exports = {
  fuzzyScore,
  highlightPositions,
};

