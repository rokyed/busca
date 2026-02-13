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

#### Global install (SSH):

```bash
npm install -g git+ssh://git@github.com/rokyed/busca.git
```

#### Global install (HTTPS):

```bash
npm install -g github:rokyed/busca
```

#### Install manually:

```bash
git clone git@github.com:rokyed/busca.git
cd busca
npm install
npm link
```

## Usage

```bash
busca
busca /path/to/project
```
