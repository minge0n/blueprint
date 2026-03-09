from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Any


OPEN_CODE_DIRNAME = "opencode"
OPEN_CODE_CONFIG_FILENAME = "opencode.json"


def get_repo_root() -> Path:
    return Path(__file__).resolve().parent


def get_global_config_dir() -> Path:
    xdg_config_home = os.environ.get("XDG_CONFIG_HOME")

    if xdg_config_home is not None and xdg_config_home != "":
        base_dir = Path(xdg_config_home)
    else:
        base_dir = Path.home() / ".config"

    return base_dir / OPEN_CODE_DIRNAME


def build_global_config_fragment(repo_root: Path) -> dict[str, object]:
    plugin_path = repo_root / ".opencode" / "plugin.ts"
    command = [str(repo_root / ".venv" / "bin" / "python"), "-m", "blueprint_fastmcp"]

    return {
        "plugin": [str(plugin_path)],
        "agent": {
            "blueprint-planner": {
                "description": "Verifies that Blueprint work plans are executable and unblocked.",
                "tools": {
                    "read": True,
                    "glob": True,
                    "grep": True,
                    "bash": False,
                    "edit": False,
                    "write": False,
                },
                "prompt": "You are a practical work plan reviewer. You verify that plans are executable and references are valid. You are a blocker-finder, not a perfectionist.",
            },
            "blueprint-builder": {
                "description": "Implements Blueprint work in OpenCode with orchestration-oriented behavior.",
                "tools": {
                    "read": True,
                    "glob": True,
                    "grep": True,
                    "bash": True,
                    "edit": True,
                    "write": True,
                },
                "prompt": "You are Sisyphus adapted for Blueprint in OpenCode. Parse user intent carefully, do not implement unless the user explicitly wants implementation, prefer delegation when specialist roles fit, and keep work aligned with the Python FastMCP Blueprint workflow.",
            },
            "blueprint-coordinator": {
                "description": "Coordinates Blueprint workflow progress using the global Blueprint MCP server setup.",
                "tools": {
                    "read": True,
                    "glob": True,
                    "grep": True,
                    "bash": True,
                    "edit": False,
                    "write": False,
                },
                "prompt": "You coordinate Blueprint work in OpenCode. Always start with blueprint_resume or blueprint_get_context and use Blueprint MCP tools to determine next actions.",
            },
            "blueprint-worker": {
                "description": "Executes a Blueprint function unit with checkpoint and lock discipline.",
                "tools": {
                    "read": True,
                    "glob": True,
                    "grep": True,
                    "bash": True,
                    "edit": True,
                    "write": True,
                },
                "prompt": "You implement a Blueprint function unit in OpenCode. Start with blueprint_resume and maintain checkpoint and lock state throughout execution.",
            },
            "blueprint-skeptic": {
                "description": "Reviews Blueprint plans and builds using the Blueprint MCP tool surface.",
                "tools": {
                    "read": True,
                    "glob": True,
                    "grep": True,
                    "bash": True,
                    "edit": False,
                    "write": False,
                },
                "prompt": "You review Blueprint state in OpenCode. Validate plans/builds through blueprint_get_context, issue tools, and approval gate tools.",
            },
        },
        "command": {
            "blueprint-status": {
                "description": "Summarize current Blueprint workflow status",
                "template": "Use blueprint_resume and blueprint_get_context to summarize the active feature, cycle, blockers, and next recommended action.",
            },
            "blueprint-test": {
                "description": "Run Python FastMCP tests",
                "template": f"Run `{repo_root / '.venv' / 'bin' / 'python'} -m unittest discover -s python_tests` in `{repo_root}` and summarize the result.",
            },
        },
        "mcp": {
            "blueprint": {
                "type": "local",
                "enabled": True,
                "command": command,
                "environment": {
                    "BLUEPRINT_HOST": "127.0.0.1",
                    "BLUEPRINT_PORT": "8000",
                    "BLUEPRINT_MCP_PATH": "/mcp",
                    "BLUEPRINT_HOME": str(Path.home() / ".blueprint"),
                },
            }
        },
    }


def _merge_dicts(base: dict[str, Any], overlay: dict[str, Any]) -> dict[str, Any]:
    merged = dict(base)

    for key, value in overlay.items():
        existing_value = merged.get(key)

        if isinstance(existing_value, dict) and isinstance(value, dict):
            merged[key] = _merge_dicts(existing_value, value)
            continue

        if isinstance(existing_value, list) and isinstance(value, list):
            combined: list[Any] = list(existing_value)
            for item in value:
                if item not in combined:
                    combined.append(item)
            merged[key] = combined
            continue

        merged[key] = value

    return merged


def load_existing_config(config_path: Path) -> dict[str, Any]:
    if not config_path.exists():
        return {"$schema": "https://opencode.ai/config.json"}

    raw_config = config_path.read_text(encoding="utf-8")
    loaded = json.loads(raw_config)

    if not isinstance(loaded, dict):
        raise ValueError(
            f"Existing OpenCode config must be a JSON object: {config_path}"
        )

    return loaded


def install_global_config(config_dir: Path, repo_root: Path) -> Path:
    config_dir.mkdir(parents=True, exist_ok=True)
    config_path = config_dir / OPEN_CODE_CONFIG_FILENAME
    existing = load_existing_config(config_path)
    fragment = build_global_config_fragment(repo_root)
    merged = _merge_dicts(existing, fragment)
    if "$schema" not in merged:
        merged["$schema"] = "https://opencode.ai/config.json"
    config_path.write_text(json.dumps(merged, indent=2) + "\n", encoding="utf-8")

    return config_path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Install Blueprint as a global OpenCode configuration."
    )
    parser.add_argument(
        "--config-dir",
        type=Path,
        default=None,
        help="Override the target OpenCode config directory. Defaults to ~/.config/opencode or $XDG_CONFIG_HOME/opencode.",
    )

    return parser.parse_args()


def main() -> None:
    args = parse_args()
    repo_root = get_repo_root()
    config_dir = (
        args.config_dir if args.config_dir is not None else get_global_config_dir()
    )
    config_path = install_global_config(config_dir, repo_root)

    print(f"Installed Blueprint OpenCode config to {config_path}")


if __name__ == "__main__":
    main()
