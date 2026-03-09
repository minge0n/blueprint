#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/opencode"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --config-dir)
      CONFIG_DIR="$2"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

mkdir -p "$CONFIG_DIR"

PLUGIN_PATH="$REPO_ROOT/.opencode/plugin.ts"
PYTHON_CMD="$REPO_ROOT/.venv/bin/python"
CONFIG_PATH="$CONFIG_DIR/opencode.json"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

FRAGMENT_PATH="$TMP_DIR/blueprint_fragment.json"
MERGED_PATH="$TMP_DIR/opencode_merged.json"

cat > "$FRAGMENT_PATH" <<EOF
{
  "plugin": ["$PLUGIN_PATH"],
  "agent": {
    "blueprint-planner": {
      "description": "Verifies that Blueprint work plans are executable and unblocked.",
      "tools": {
        "read": true,
        "glob": true,
        "grep": true,
        "bash": false,
        "edit": false,
        "write": false
      },
      "prompt": "You are a practical work plan reviewer. You verify that plans are executable and references are valid. You are a blocker-finder, not a perfectionist."
    },
    "blueprint-builder": {
      "description": "Implements Blueprint work in OpenCode with orchestration-oriented behavior.",
      "tools": {
        "read": true,
        "glob": true,
        "grep": true,
        "bash": true,
        "edit": true,
        "write": true
      },
      "prompt": "You are Sisyphus adapted for Blueprint in OpenCode. Parse user intent carefully, do not implement unless the user explicitly wants implementation, prefer delegation when specialist roles fit, and keep work aligned with the Python FastMCP Blueprint workflow."
    },
    "blueprint-coordinator": {
      "description": "Coordinates Blueprint workflow progress using the global Blueprint MCP server setup.",
      "tools": {
        "read": true,
        "glob": true,
        "grep": true,
        "bash": true,
        "edit": false,
        "write": false
      },
      "prompt": "You coordinate Blueprint work in OpenCode. Always start with blueprint_resume or blueprint_get_context and use Blueprint MCP tools to determine next actions."
    },
    "blueprint-worker": {
      "description": "Executes a Blueprint function unit with checkpoint and lock discipline.",
      "tools": {
        "read": true,
        "glob": true,
        "grep": true,
        "bash": true,
        "edit": true,
        "write": true
      },
      "prompt": "You implement a Blueprint function unit in OpenCode. Start with blueprint_resume and maintain checkpoint and lock state throughout execution."
    },
    "blueprint-skeptic": {
      "description": "Reviews Blueprint plans and builds using the Blueprint MCP tool surface.",
      "tools": {
        "read": true,
        "glob": true,
        "grep": true,
        "bash": true,
        "edit": false,
        "write": false
      },
      "prompt": "You review Blueprint state in OpenCode. Validate plans/builds through blueprint_get_context, issue tools, and approval gate tools."
    }
  },
  "command": {
    "blueprint-status": {
      "description": "Summarize current Blueprint workflow status",
      "template": "Use blueprint_resume and blueprint_get_context to summarize the active feature, cycle, blockers, and next recommended action."
    },
    "blueprint-test": {
      "description": "Run Python FastMCP tests",
      "template": "Run $PYTHON_CMD -m unittest discover -s python_tests in $REPO_ROOT and summarize the result."
    }
  },
  "mcp": {
    "blueprint": {
      "type": "local",
      "enabled": true,
      "command": ["$PYTHON_CMD", "-m", "blueprint_fastmcp"],
      "environment": {
        "BLUEPRINT_HOST": "127.0.0.1",
        "BLUEPRINT_PORT": "8000",
        "BLUEPRINT_MCP_PATH": "/mcp",
        "BLUEPRINT_HOME": "$HOME/.blueprint"
      }
    }
  }
}
EOF

if [[ -f "$CONFIG_PATH" ]]; then
  EXISTING_CONFIG_PATH="$CONFIG_PATH"
else
  EXISTING_CONFIG_PATH="$TMP_DIR/opencode_base.json"
  cat > "$EXISTING_CONFIG_PATH" <<EOF
{
  "\$schema": "https://opencode.ai/config.json"
}
EOF
fi

"$PYTHON_CMD" - "$EXISTING_CONFIG_PATH" "$FRAGMENT_PATH" "$MERGED_PATH" <<'PY'
import json
import sys
from pathlib import Path


def merge(base, overlay):
    merged = dict(base)
    for key, value in overlay.items():
        existing = merged.get(key)
        if isinstance(existing, dict) and isinstance(value, dict):
            merged[key] = merge(existing, value)
        elif isinstance(existing, list) and isinstance(value, list):
            combined = list(existing)
            for item in value:
                if item not in combined:
                    combined.append(item)
            merged[key] = combined
        else:
            merged[key] = value
    return merged


base_path = Path(sys.argv[1])
fragment_path = Path(sys.argv[2])
output_path = Path(sys.argv[3])
base = json.loads(base_path.read_text(encoding="utf-8"))
fragment = json.loads(fragment_path.read_text(encoding="utf-8"))
merged = merge(base, fragment)
if "$schema" not in merged:
    merged["$schema"] = "https://opencode.ai/config.json"
output_path.write_text(json.dumps(merged, indent=2) + "\n", encoding="utf-8")
PY

mv "$MERGED_PATH" "$CONFIG_PATH"

echo "Installed Blueprint OpenCode config to $CONFIG_PATH"
