# Gemini CLI Delegation Skill — Design Spec

**Date:** 2026-03-23
**Status:** [WIP] — design approved, skill not yet written

---

## Overview

A personal Claude Code skill that teaches Claude to invoke Gemini CLI as a subordinate agent to offload tasks. Claude decides when delegation adds value, composes a focused handoff prompt, invokes Gemini via Bash, and handles the output appropriately.

---

## Trigger Conditions

Claude invokes Gemini when one or more of these apply:

| Trigger | Example |
|---|---|
| Context-window relief | Task requires reading 10+ files; keep Claude's context free |
| Parallelism | Two independent tasks can run simultaneously |
| Second opinion | Review Claude's own draft code or plan |
| Large-scale analysis | Summarize a whole codebase, audit all routes, scan all deps |
| Explicit user request | "Use Gemini for this" |

Claude does **not** invoke Gemini for small focused tasks it can handle inline, or when the overhead of composing a handoff prompt exceeds the benefit.

---

## Preflight Check

Before the first Gemini invocation in a session, Claude verifies `gemini --version` succeeds. If it fails, Claude surfaces a clear error ("Gemini CLI not found — install it and ensure it's on PATH") rather than letting a raw command-not-found error reach the user.

---

## Two-Tier Model

### Consult Tier (read-only analysis)

Gemini analyzes and produces text. `--approval-mode plan` enforces read-only at the CLI level.

```bash
# Basic
gemini -p "<focused prompt>" --approval-mode plan --output-format text

# With directory context (pass project root by default; specific subdir if task is scoped)
gemini -p "<prompt>" --approval-mode plan --include-directories /path/to/dir --output-format text

# With piped content
cat file.txt | gemini -p "<prompt>" --approval-mode plan --output-format text
```

### Delegate Tier (autonomous action)

Gemini edits files and runs commands. **Requires explicit user confirmation before invoking.**

```bash
# Basic
gemini -p "<focused prompt>" --approval-mode yolo --output-format text

# With directory context
gemini -p "<prompt>" --approval-mode yolo --include-directories /path/to/dir --output-format text
```

**Confirmation protocol:** Before invoking Delegate tier, Claude must ask:

> "I'm going to delegate [X] to Gemini with write access. It will [specific actions, e.g., 'edit files in client/src']. Proceed?"

Claude waits for explicit user approval. No silent `--approval-mode yolo` invocations.

### Tier Selection

| Task type | Tier |
|---|---|
| Research, analysis, summarization, Q&A | Consult |
| Code review, audit, second opinion | Consult |
| Code generation, file editing, running commands | Delegate |
| Explicit implementation delegation | Delegate |

### Parallelism

When two independent **Consult-tier** tasks can run simultaneously, Claude fires two Bash tool calls in the same response, each with a separate `gemini -p` invocation. Both results are collected before Claude acts on them.

Parallel Delegate-tier invocations are not permitted — two concurrent `--approval-mode yolo` agents writing to the same codebase risk conflicting edits. Delegate tasks must be confirmed and executed one at a time.

---

## Handoff Prompt Guidelines

A good handoff prompt:
- States the task in one sentence
- Includes relevant file paths, error messages, or constraints
- Specifies expected output format (e.g., "return a bullet list", "output only the fixed code")
- For Delegate tier: states what Gemini is and isn't allowed to touch

### Directory Context

Pass the project root by default. If the task is scoped to a specific subdirectory, pass that subdirectory instead. Pass multiple directories only when the task explicitly requires cross-tree context.

---

## Output Handling

| Mode | When | How |
|---|---|---|
| Synthesize | Research, analysis, Q&A | Claude reads output, distills key findings, presents summary |
| Pass-through | Review, second opinion | Prefix with `Gemini (Consult):` and wrap in blockquote |
| Act-on-it | Code review → fixes, plan critique → revisions | Claude applies or responds to Gemini's findings |

**Default:** When in doubt, use Synthesize. Use Pass-through only when Gemini's exact wording is the value (e.g., a formatted review). Use Act-on-it only when Claude has an artifact (plan, draft) to update.

---

## Error Handling

- Non-zero exit or empty output → report to user, don't silently fail
- Gemini output contradicts Claude's plan → surface the conflict, let user decide
- Long-running calls (large-scale analysis) may take 30–120 seconds — warn the user upfront
