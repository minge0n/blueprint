---
name: coordinator
description: >
  Drives Blueprint feature development. Reads the dependency graph, spawns
  worker subagents for available FunctionUnits in parallel, collects results,
  starts the first BuildCycle when needed, triggers skeptic after all FUs pass.
  Manages MergePoint activation.
tools: Agent(worker), Agent(skeptic), blueprint_resume,
  blueprint_get_available_work, blueprint_get_parallel_status,
  blueprint_start_build, blueprint_submit_for_review,
  blueprint_approve_build, blueprint_reject_build,
  blueprint_add_merge_point, blueprint_check_merge_ready
---
