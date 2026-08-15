# Governed Execution Proof

- run_id: `20260815T050438Z-edafd6df`
- mode: `interactive_governed`
- profile: `repo_safe_execution_closure`
- proof_class: `runtime`
- executed_unit_count: `4`
- successful_unit_count: `3`
- failed_unit_count: `1`
- delegated_lane_count: `2`
- review_receipt_count: `4`
- specialist_recommendation_count: `2`
- specialist_dispatch_unit_count: `2`
- attempted_specialist_unit_count: `0`
- executed_specialist_unit_count: `0`
- failed_specialist_unit_count: `0`
- direct_routed_specialist_unit_count: `2`
- blocked_specialist_unit_count: `0`
- degraded_specialist_unit_count: `0`
- auto_approved_specialist_unit_count: `0`
- residual_local_specialist_suggestion_count: `0`
- specialist_execution_status: `direct_current_session_routed`
- dispatch_integrity_proof_passed: `True`
- execution_manifest: `/mnt/ai/workspaces/chat_app/outputs/runtime/vibe-sessions/20260815T050438Z-edafd6df/execution-manifest.json`
- execution_topology: `/mnt/ai/workspaces/chat_app/outputs/runtime/vibe-sessions/20260815T050438Z-edafd6df/execution-topology.json`
- plan_shadow: `/mnt/ai/workspaces/chat_app/outputs/runtime/vibe-sessions/20260815T050438Z-edafd6df/plan-derived-execution-shadow.json`

## Specialist User Disclosure
Pre-dispatch specialist disclosure:
- scrapling -> /mnt/CRISHDD1/home_configs/.codex/skills/vibe/bundled/skills/scrapling/SKILL.runtime-mirror.md
- spreadsheet -> /mnt/CRISHDD1/home_configs/.codex/skills/vibe/bundled/skills/spreadsheet/SKILL.runtime-mirror.md

## wave-1
- status: failed
- executed_unit_count: 4
- unit `runtime-neutral-freshness-gate-tests` -> status `failed`, exit_code `1`
- unit `release-install-runtime-coherence-gate` -> status `completed`, exit_code `0`
- unit `specialist-in_execution-ungrouped-scrapling-specialist` -> status `completed`, exit_code `0`
- unit `specialist-in_execution-ungrouped-spreadsheet-specialist` -> status `completed`, exit_code `0`

