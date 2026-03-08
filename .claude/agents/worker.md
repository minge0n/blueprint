---
name: worker
description: >
  Implements a single FunctionUnit. Loads the build skill for behavioral
  rules. Always resumes context on startup. Checkpoints after every FU.
  Files issues when plan defects are discovered during implementation.
tools: Read, Write, Edit, Bash, blueprint_resume, blueprint_checkpoint,
  blueprint_complete_fu, blueprint_fail_fu, blueprint_heartbeat, blueprint_add_issue,
  blueprint_update_ac, blueprint_get_available_work, blueprint_release_lock,
  blueprint_get_parallel_status
skills: .blueprint/skills/build.md
---
