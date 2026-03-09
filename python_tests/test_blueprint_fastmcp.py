from __future__ import annotations

import json
import os
import shutil
import tempfile
import unittest
from pathlib import Path

from install_claude_code import (
    build_claude_agents,
    build_claude_settings_fragment,
    install_global_claude_config,
)
from install_opencode import build_global_config_fragment, install_global_config
from blueprint_fastmcp.audit import get_status_history
from blueprint_fastmcp.db import (
    close_db,
    get_blueprint_directory,
    get_db,
    reset_db_for_tests,
)
from blueprint_fastmcp.repository import (
    add_acceptance_criteria,
    add_dependency,
    add_function_unit,
    add_issue,
    add_merge_point,
    approve_build,
    approve_plan,
    check_merge_ready,
    checkpoint,
    complete_fu,
    create_feature,
    export_markdown,
    get_available_work,
    get_context,
    get_full_feature,
    get_history,
    get_parallel_status,
    heartbeat,
    list_features,
    list_issues,
    reject_build,
    resolve_issue,
    release_lock,
    resume,
    run_coordinator,
    start_build,
    start_plan_review,
    submit_build_for_review,
    update_acceptance_criteria,
)


class BlueprintFastMCPTests(unittest.TestCase):
    def setUp(self) -> None:
        self._old_blueprint_home = os.environ.get("BLUEPRINT_HOME")
        self._temp_directory = tempfile.mkdtemp(prefix="blueprint_fastmcp_")
        os.environ["BLUEPRINT_HOME"] = self._temp_directory
        reset_db_for_tests()

    def tearDown(self) -> None:
        close_db()

        if self._old_blueprint_home is None:
            os.environ.pop("BLUEPRINT_HOME", None)
        else:
            os.environ["BLUEPRINT_HOME"] = self._old_blueprint_home

        shutil.rmtree(self._temp_directory, ignore_errors=True)

    def test_db_initializes_under_blueprint_home(self) -> None:
        directory = get_blueprint_directory()
        db = get_db()
        pragma_row = db.execute("PRAGMA foreign_keys").fetchone()

        self.assertEqual(directory, Path(self._temp_directory))
        self.assertEqual(pragma_row["foreign_keys"], 1)

    def test_core_feature_flow(self) -> None:
        feature = create_feature(
            title="Login",
            scope="Implement basic login",
            out_of_scope="Password reset",
            priority="p1",
        )
        function_unit = add_function_unit(
            feature_id=feature["id"],
            title="Validate credentials",
            description="Verify submitted username and password",
        )
        acceptance_criteria = add_acceptance_criteria(
            fu_id=function_unit["id"],
            description="Returns success for valid credentials",
            ac_type="functional",
            severity="must",
        )
        updated_acceptance_criteria = update_acceptance_criteria(
            ac_id=acceptance_criteria["id"],
            status="passed",
            verified_in="build_1",
            evidence="unit test output",
        )
        loaded_feature = get_full_feature(feature["id"])

        self.assertIsNotNone(loaded_feature)

        if loaded_feature is None:
            raise AssertionError("Expected loaded feature")

        self.assertEqual(len(list_features()), 1)
        self.assertEqual(updated_acceptance_criteria["status"], "passed")
        self.assertEqual(
            loaded_feature["function_units"][0]["acceptance_criteria"][0]["id"],
            acceptance_criteria["id"],
        )

    def test_status_audit_history_is_recorded(self) -> None:
        feature = create_feature(
            title="Signup",
            scope="Implement signup",
            out_of_scope="Email verification",
            priority="p0",
        )
        history = get_status_history("feature", feature["id"])

        self.assertEqual(len(history), 1)
        self.assertEqual(history[0]["new_status"], "draft")

    def test_plan_build_issue_and_gate_flow(self) -> None:
        feature = create_feature(
            title="Checkout",
            scope="Implement checkout",
            out_of_scope="Refunds",
            priority="p0",
        )
        function_unit = add_function_unit(
            feature_id=feature["id"],
            title="Submit order",
            description="Persist an order and return confirmation",
        )
        acceptance_criteria = add_acceptance_criteria(
            fu_id=function_unit["id"],
            description="Creates an order successfully",
            ac_type="functional",
            severity="must",
        )

        plan_cycle = start_plan_review(feature_id=feature["id"])
        approved_plan = approve_plan(plan_cycle_id=plan_cycle["id"])

        self.assertEqual(approved_plan["plan_cycle_status"], "approved")
        self.assertEqual(approved_plan["feature_status"], "building")

        build_start = start_build(feature_id=feature["id"], agent_id="worker-1")
        build_cycle = build_start.get("build_cycle")

        if not isinstance(build_cycle, dict):
            raise AssertionError("Expected build cycle payload")

        update_acceptance_criteria(
            ac_id=acceptance_criteria["id"],
            status="passed",
            verified_in=str(build_cycle["id"]),
            evidence="python test evidence",
        )
        db = get_db()
        db.execute(
            "UPDATE function_units SET status = ?, test_evidence = ? WHERE id = ?",
            ("passed", "python test evidence", function_unit["id"]),
        )
        db.commit()

        review_result = submit_build_for_review(build_cycle_id=str(build_cycle["id"]))
        reviewed_cycle = review_result.get("build_cycle")

        if not isinstance(reviewed_cycle, dict):
            raise AssertionError("Expected reviewed build cycle payload")

        self.assertEqual(reviewed_cycle["status"], "reviewing")

        issue = add_issue(
            parent_type="build",
            parent_id=str(build_cycle["id"]),
            fu_id=function_unit["id"],
            category="implementation",
            severity="critical",
            title="Broken confirmation payload",
            description="Confirmation body is malformed.",
        )
        listed_issues = list_issues(feature_id=feature["id"], status="open")

        self.assertEqual(len(listed_issues), 1)
        self.assertEqual(listed_issues[0]["id"], issue["id"])

        rejected_build = reject_build(build_cycle_id=str(build_cycle["id"]))

        self.assertEqual(rejected_build["build_cycle_status"], "rejected")
        self.assertEqual(rejected_build["feature_status"], "building")

        resolve_issue(
            issue_id=issue["id"],
            status="resolved",
            resolved_in=str(build_cycle["id"]),
            resolution_note="Fixed in follow-up run",
        )

        next_build = start_build(feature_id=feature["id"], agent_id="worker-2")
        next_build_cycle = next_build.get("build_cycle")

        if not isinstance(next_build_cycle, dict):
            raise AssertionError("Expected next build cycle payload")

        db.execute(
            "UPDATE function_units SET status = ?, test_evidence = ? WHERE id = ?",
            ("passed", "python test evidence retry", function_unit["id"]),
        )
        db.execute(
            "UPDATE acceptance_criteria SET status = ?, verified_in = ?, evidence = ? WHERE id = ?",
            (
                "passed",
                str(next_build_cycle["id"]),
                "retry evidence",
                acceptance_criteria["id"],
            ),
        )
        db.commit()

        submit_build_for_review(build_cycle_id=str(next_build_cycle["id"]))
        approved_build = approve_build(build_cycle_id=str(next_build_cycle["id"]))

        self.assertEqual(approved_build["build_cycle_status"], "approved")
        self.assertEqual(approved_build["feature_status"], "done")

    def test_dependency_and_merge_point_flow(self) -> None:
        feature = create_feature(
            title="Parallel Feature",
            scope="Exercise dependencies and merge points",
            out_of_scope="External services",
            priority="p1",
        )
        left_fu = add_function_unit(
            feature_id=feature["id"],
            title="Left branch",
            description="Implement left side",
        )
        right_fu = add_function_unit(
            feature_id=feature["id"],
            title="Right branch",
            description="Implement right side",
        )
        merged_fu = add_function_unit(
            feature_id=feature["id"],
            title="Merge branch",
            description="Combine both branches",
        )

        dependency = add_dependency(
            fu_id=merged_fu["id"],
            depends_on_fu_id=left_fu["id"],
            dependency_type="hard",
        )
        merge_point = add_merge_point(
            feature_id=feature["id"],
            trigger_fus=[left_fu["id"], right_fu["id"]],
            merged_fu=merged_fu["id"],
        )

        self.assertEqual(dependency["type"], "hard")
        self.assertEqual(merge_point["status"], "waiting")

        db = get_db()
        db.execute(
            "UPDATE function_units SET status = ? WHERE id IN (?, ?)",
            ("passed", left_fu["id"], right_fu["id"]),
        )
        db.commit()

        readiness = check_merge_ready(merge_point_id=str(merge_point["id"]))
        readiness_merge_point = readiness.get("merge_point")

        if not isinstance(readiness_merge_point, dict):
            raise AssertionError("Expected merge point payload")

        self.assertTrue(readiness["ready"])
        self.assertEqual(readiness_merge_point["status"], "ready")

    def test_resume_context_export_and_parallel_tools(self) -> None:
        feature = create_feature(
            title="Context Feature",
            scope="Exercise runtime context helpers",
            out_of_scope="Remote deploys",
            priority="p0",
        )
        fu = add_function_unit(
            feature_id=feature["id"],
            title="Do work",
            description="Perform a single unit of work",
        )
        acceptance_criteria = add_acceptance_criteria(
            fu_id=fu["id"],
            description="Does the work",
            ac_type="functional",
            severity="must",
        )

        plan_cycle = start_plan_review(feature_id=feature["id"])
        approve_plan(plan_cycle_id=plan_cycle["id"])
        build_start = start_build(feature_id=feature["id"], agent_id="coord")
        build_cycle = build_start.get("build_cycle")

        if not isinstance(build_cycle, dict):
            raise AssertionError("Expected build cycle payload")

        assignment = get_available_work(agent_id="worker-a")

        self.assertIsNotNone(assignment)

        if assignment is None:
            raise AssertionError("Expected assignment")

        checkpoint_result = checkpoint(
            build_cycle_id=str(build_cycle["id"]),
            agent_id="worker-a",
            completed_fu=fu["id"],
            next_fu=None,
            notes="done",
        )
        work_lock = assignment.get("work_lock")

        if not isinstance(work_lock, dict):
            raise AssertionError("Expected work lock payload")

        heartbeat_result = heartbeat(lock_id=str(work_lock["id"]), agent_id="worker-a")
        self.assertEqual(heartbeat_result["status"], "active")

        complete_result = complete_fu(
            build_cycle_id=str(build_cycle["id"]),
            fu_id=fu["id"],
            agent_id="worker-a",
            evidence="all good",
        )
        self.assertEqual(complete_result["status"], "passed")
        update_acceptance_criteria(
            ac_id=acceptance_criteria["id"],
            status="passed",
            verified_in=str(build_cycle["id"]),
            evidence="all good",
        )

        released_lock = release_lock(lock_id=str(work_lock["id"]), agent_id="worker-a")
        self.assertEqual(released_lock["status"], "released")
        self.assertEqual(checkpoint_result["notes"], "done")

        resume_result = resume(agent_id="worker-a")
        active_feature = resume_result.get("active_feature")

        if not isinstance(active_feature, dict):
            raise AssertionError("Expected active feature payload")

        self.assertEqual(active_feature["id"], feature["id"])

        parallel_status = get_parallel_status(feature_id=feature["id"])
        self.assertIsInstance(parallel_status["available_fus"], list)

        context = get_context(feature_id=feature["id"])
        context_feature = context.get("feature")

        if not isinstance(context_feature, dict):
            raise AssertionError("Expected context feature payload")

        self.assertEqual(context_feature["id"], feature["id"])

        export_result = export_markdown(feature_id=feature["id"])
        self.assertIn(feature["title"], str(export_result["markdown"]))

        history = get_history(feature_id=feature["id"])
        self.assertEqual(history["feature_id"], feature["id"])

        submit_build_for_review(build_cycle_id=str(build_cycle["id"]))
        approve_build(build_cycle_id=str(build_cycle["id"]))

    def test_coordinator_smoke(self) -> None:
        feature = create_feature(
            title="Coordinator Feature",
            scope="Exercise coordinator loop",
            out_of_scope="Distributed scheduling",
            priority="p1",
        )
        fu = add_function_unit(
            feature_id=feature["id"],
            title="Coordinator task",
            description="Single task for coordinator",
        )
        add_acceptance_criteria(
            fu_id=fu["id"],
            description="Coordinator task passes",
            ac_type="functional",
            severity="must",
        )

        plan_cycle = start_plan_review(feature_id=feature["id"])
        approve_plan(plan_cycle_id=plan_cycle["id"])
        result = run_coordinator(
            coordinator_agent_id="coord",
            worker_agent_ids=["worker-a", "worker-b"],
            max_iterations=1,
        )

        self.assertEqual(result["feature_id"], feature["id"])

    def test_opencode_config_matches_python_runtime(self) -> None:
        config_path = Path(__file__).resolve().parent.parent / "opencode.jsonc"
        raw_config = config_path.read_text(encoding="utf-8")

        self.assertIn(
            '"command": [".venv/bin/python", "-m", "blueprint_fastmcp"]',
            raw_config,
        )
        self.assertIn('"BLUEPRINT_MCP_PATH": "/mcp"', raw_config)
        self.assertIn('"blueprint-status"', raw_config)
        self.assertIn('"blueprint-coordinator"', raw_config)

    def test_global_opencode_installer_writes_expected_config(self) -> None:
        config_dir = Path(self._temp_directory) / "opencode"
        config_path = install_global_config(
            config_dir, Path(__file__).resolve().parent.parent
        )
        installed = json.loads(config_path.read_text(encoding="utf-8"))
        built = build_global_config_fragment(Path(__file__).resolve().parent.parent)

        if not isinstance(installed, dict):
            raise AssertionError("Expected installed OpenCode config mapping")

        built_mcp = built.get("mcp")
        built_plugin = built.get("plugin")
        built_agent = built.get("agent")

        if not isinstance(built_mcp, dict):
            raise AssertionError("Expected built mcp mapping")

        if not isinstance(built_plugin, list):
            raise AssertionError("Expected built plugin list")

        if not isinstance(built_agent, dict):
            raise AssertionError("Expected built agent mapping")

        installed_mcp = installed.get("mcp")
        installed_plugin = installed.get("plugin")
        installed_agent = installed.get("agent")

        if not isinstance(installed_mcp, dict):
            raise AssertionError("Expected installed mcp mapping")

        if not isinstance(installed_plugin, list):
            raise AssertionError("Expected installed plugin list")

        if not isinstance(installed_agent, dict):
            raise AssertionError("Expected installed agent mapping")

        self.assertEqual(
            installed_mcp["blueprint"]["command"],
            built_mcp["blueprint"]["command"],
        )
        self.assertEqual(installed_plugin, built_plugin)
        self.assertIn("blueprint-worker", installed_agent)
        self.assertIn("blueprint-planner", installed_agent)
        self.assertIn("blueprint-builder", installed_agent)

    def test_global_opencode_installer_merges_existing_config(self) -> None:
        config_dir = Path(self._temp_directory) / "merged-opencode"
        config_dir.mkdir(parents=True, exist_ok=True)
        config_path = config_dir / "opencode.json"
        config_path.write_text(
            json.dumps(
                {
                    "$schema": "https://opencode.ai/config.json",
                    "plugin": ["/existing/plugin.ts"],
                    "command": {
                        "existing-command": {
                            "description": "keep me",
                            "template": "echo keep",
                        }
                    },
                    "agent": {
                        "existing-agent": {
                            "description": "keep me",
                            "prompt": "keep me",
                        }
                    },
                    "mcp": {
                        "existing": {
                            "type": "local",
                            "enabled": True,
                            "command": ["echo", "existing"],
                        }
                    },
                },
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )

        install_global_config(config_dir, Path(__file__).resolve().parent.parent)
        installed = json.loads(config_path.read_text(encoding="utf-8"))

        self.assertIn("/existing/plugin.ts", installed["plugin"])
        self.assertIn("existing-command", installed["command"])
        self.assertIn("existing-agent", installed["agent"])
        self.assertIn("existing", installed["mcp"])
        self.assertIn("blueprint", installed["mcp"])

    def test_shell_installer_exists(self) -> None:
        installer_path = Path(__file__).resolve().parent.parent / "install_opencode.sh"
        contents = installer_path.read_text(encoding="utf-8")

        self.assertTrue(contents.startswith("#!/usr/bin/env bash"))
        self.assertIn('"command": ["$PYTHON_CMD", "-m", "blueprint_fastmcp"]', contents)

    def test_claude_code_installer_writes_expected_files(self) -> None:
        config_dir = Path(self._temp_directory) / ".claude"
        settings_path, agents_dir = install_global_claude_config(
            config_dir, Path(__file__).resolve().parent.parent
        )
        settings = json.loads(settings_path.read_text(encoding="utf-8"))
        fragment = build_claude_settings_fragment()
        agents = build_claude_agents(Path(__file__).resolve().parent.parent)

        self.assertEqual(
            settings["env"]["BLUEPRINT_MCP_PATH"], fragment["env"]["BLUEPRINT_MCP_PATH"]
        )
        self.assertTrue((agents_dir / "blueprint-planner.md").exists())
        self.assertTrue((agents_dir / "blueprint-builder.md").exists())
        self.assertIn("blueprint-planner", agents["blueprint-planner.md"])

    def test_claude_code_installer_merges_existing_settings(self) -> None:
        config_dir = Path(self._temp_directory) / "merged-claude"
        config_dir.mkdir(parents=True, exist_ok=True)
        settings_path = config_dir / "settings.json"
        settings_path.write_text(
            json.dumps(
                {
                    "$schema": "https://json.schemastore.org/claude-code-settings.json",
                    "env": {"EXISTING_FLAG": "1"},
                },
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )

        install_global_claude_config(config_dir, Path(__file__).resolve().parent.parent)
        merged = json.loads(settings_path.read_text(encoding="utf-8"))

        self.assertEqual(merged["env"]["EXISTING_FLAG"], "1")
        self.assertEqual(merged["env"]["BLUEPRINT_MCP_PATH"], "/mcp")


if __name__ == "__main__":
    unittest.main()
