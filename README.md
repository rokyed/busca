# busca

Fast terminal search TUI powered by `ripgrep`.

## What It Does

- `rg` term panel: case-insensitive source search.
- fuzzy panel: narrows matches by file, line, and content.
- preview panel: navigate with `hjkl`/arrows, visual select with `v`.

## Requirements

- Node.js (v18+ recommended)
- npm
- `rg` (`ripgrep`) (required)
- `bat` (optional, for syntax-highlighted preview)

Homebrew (macOS/Linux) example:

```bash
brew install ripgrep bat
```

## Install

```bash
npm install
npm link
```

## Usage

```bash
busca
busca /path/to/project
```
