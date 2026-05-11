# ARCHITECTURE

## Data flow
1. CLI input -> request parse (YAML/JSON or natural language)
2. Planner -> MetalComplexRequest
3. Executor -> molSimplify wrapper
4. Evaluator -> ASE validation
5. Persist all artifacts to outputs/YYYY-MM-DD_run_xxxx

## Modules
- `agent`: planning/execution/evaluation loop
- `tools`: external tool adapters
- `validation`: geometry/chemistry checks
- `io`: file and run logging helpers
