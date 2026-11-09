# Evaluation cases

Add representative scenarios for important user-facing behavior and known regressions as `*.eval.test.ts` Vitest files. Run them with `pnpm eval`. Each case should include its input, expected outcome, and a clear pass/fail criterion. Prefer deterministic cases that can be reviewed and rerun; do not make probabilistic model output the only pass/fail signal. `api-readiness.eval.test.ts` protects the API's not-ready response and checks that connection details are not exposed.
