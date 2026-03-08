# Install

## Requirements

- Bun `1.3.9` or compatible
- Node.js available for the test script
- macOS, Linux, or another environment supported by `better-sqlite3`

## 1. Clone

```bash
git clone https://github.com/minge0n/blueprint.git
cd blueprint
```

## 2. Install Dependencies

```bash
bun install
```

## 3. Build

```bash
bun run build
```

## 4. Test

```bash
bun run test
```

## 5. Run Locally

```bash
bun run dev
```

This starts the Blueprint MCP server over stdio.

## Data Directory

By default Blueprint writes local runtime data to:

```text
~/.blueprint/
```

To override it:

```bash
export BLUEPRINT_HOME=/path/to/custom-blueprint-home
```

## Production Start

After building:

```bash
bun run build
node dist/index.js
```

## Notes

- `bun run test` uses Node's test runner with `tsx`
- SQLite database files are created automatically on first start
- Runtime exports are written under `~/.blueprint/exports/`
- Local database artifacts are ignored by git via `.gitignore`
