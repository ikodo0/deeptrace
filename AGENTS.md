# DeepTrace Engineering Workflow

These instructions apply to the entire repository.

## Sources of Truth

- `PLAN.md` defines product scope and architecture.
- `docs/CONTRACT.md` defines the approved source-adapter boundary.
- `docs/EXECUTION_PLAN.md` defines task order, dependencies, and acceptance criteria.
- The active user request takes precedence over stale planning details.

Do not invent unresolved chains, deployments, formulas, limits, source behavior, or
fallbacks. Stop at the relevant dependency gate and report what is missing.

## Branch Model

- `main` is the stable, demo-ready release branch.
- `develop` is the integration and recovery branch.
- Create each task branch from an up-to-date `develop`.
- Merge task branches into `develop` through pull requests.
- Promote selected reviewed work from `develop` to `main` through a release pull
  request.
- Never push directly to `develop` or `main`.
- Never merge a feature branch directly into `main`.

Use branch names tied to one deliverable:

```text
feature/pool-normalization
fix/source-timeout-status
test/partial-source-response
docs/global-execution-plan
integration/compare-pools-live
```

Avoid person-number names and ambiguous terms such as `contracts` when the work is
actually schemas or interfaces.

## Small-Change Rule

One task branch contains one reviewable outcome.

- Prefer one to three logical commits per pull request.
- Keep every commit coherent and buildable.
- Change only files required by the task.
- Add tests in the same packet as the behavior they verify.
- Do not mix features, unrelated refactors, formatting sweeps, generated files, and
  planning cleanup.
- Preserve unrelated user and teammate changes.

Do not commit scratch notes, raw agent conversations, temporary prompts, or abandoned
plans.

## Engineering Loop

For every task:

1. Read the applicable plan section, acceptance criteria, and current implementation.
2. Confirm that dependencies and shared interfaces are available.
3. Update local `develop` with a fast-forward-only pull.
4. Create one descriptive task branch from `develop`.
5. Write or identify the acceptance test.
6. Implement the smallest change that satisfies the task.
7. Run focused tests after each logical change.
8. Run the complete repository quality gate.
9. Review the diff for unrelated changes and hidden assumptions.
10. Create one to three intentional commits.
11. Push the task branch and open a pull request into `develop`.
12. Merge only after CI and independent review pass.
13. Start dependent work from the newly updated `develop`.

Repository quality gate:

```text
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
```

Do not hide a failing check or weaken validation merely to make CI pass.

## Multi-Agent Policy

Use at most one implementation worker and one independent review worker for a single
task unless the user explicitly authorizes broader parallel work.

The implementation worker:

- works only on the assigned task and owned paths;
- confirms dependencies before editing;
- does not expand product scope;
- adds the required tests;
- reports changed files, checks, assumptions, and blockers;
- does not commit, push, merge, or open a PR unless explicitly instructed.

The review worker starts only after the implementation diff is ready. It:

- reviews the complete diff against the applicable task and sources of truth;
- checks correctness, regressions, precision, determinism, security, and scope;
- reports findings by severity with file and line references;
- states residual risks when there are no findings;
- does not edit files unless explicitly reassigned to fix a finding.

The primary developer or orchestrating agent resolves findings and owns commits,
pushes, pull requests, and merges.

Parallel work is allowed only when:

- tasks have no dependency relationship;
- owned files do not overlap;
- their shared interface is already approved;
- each task has its own branch or isolated worktree.

## Cursor Agent CLI

Cursor Agent may be used as a bounded implementation or review worker.

- Prefer `cursor-agent --mode plan --print` for read-only planning or review.
- Use `--worktree` for isolated implementation when the task can run independently.
- Give the worker one task ID, owned paths, dependencies, and acceptance criteria.
- Do not use `--force` or `--yolo` unless the user explicitly requests that risk.
- Do not let Cursor and another implementation worker edit the same files.
- The primary orchestrator inspects all Cursor-produced changes before staging them.

## Ownership Boundary

The source owner is authoritative for:

```text
src/sources/
src/registry/
tests/integration/
tests/parity/
```

The core/MCP owner is authoritative for:

```text
src/mcp/
src/tools/
src/schemas/
src/normalization/
src/metrics/
src/quality/
src/reasoning/
skill/
tests/unit/
```

Shared source schemas are changed through a dedicated contract/schema pull request
reviewed by both owners. Core logic consumes canonical source results and must not
depend on raw GraphQL or Nuthatch response shapes.

## Pull Request Standard

Every pull request into `develop` states:

- what changed and why;
- what is intentionally out of scope;
- checks run;
- dependencies and shared-interface assumptions;
- risk and a simple rollback path.

Review the complete diff, not only the final commit. Use squash merge so `develop`
receives one atomic, revertible change.

## Recovery

- Before merge, close or abandon the task PR.
- After merge, create a revert or fix branch from current `develop`.
- Revert shared work through a pull request.
- Do not force-push, rewrite shared history, or use destructive reset to undo work.
- Promote only intentionally selected `develop` state to `main`.

## Documentation Discipline

Commit documentation that remains useful after implementation:

- product and execution sources of truth;
- setup and client configuration;
- public schemas and methodologies;
- source coverage and known limitations;
- durable architectural decisions.

Update an existing source-of-truth document instead of creating overlapping plans.
