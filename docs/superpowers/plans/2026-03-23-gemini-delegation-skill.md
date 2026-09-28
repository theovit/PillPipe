# Gemini Delegation Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create `~/.claude/skills/gemini-delegation/SKILL.md` — a personal Claude Code skill that teaches Claude to invoke Gemini CLI as a subordinate agent for offloading research, analysis, code generation, and review tasks.

**Architecture:** Single SKILL.md file. Two-tier model (Consult with `--approval-mode plan` / Delegate with `--approval-mode yolo`). Follows RED-GREEN-REFACTOR from the `writing-skills` methodology — baseline subagent tests before writing, then test with skill loaded.

**Tech Stack:** Gemini CLI v0.34.0, Bash, Claude Code personal skills system (`~/.claude/skills/`)

**Spec:** `docs/superpowers/specs/2026-03-23-gemini-delegation-design.md`

---

### Task 1: RED Phase — Baseline Subagent Tests (without skill)

**Files:**
- No files created or modified

Run two subagent pressure scenarios to document what Claude does naturally *without* the skill. This is the failing test — record exact rationalizations and wrong choices.

- [ ] **Step 1: Run baseline scenario 1 — research offload**

Dispatch a subagent (general-purpose) with this exact prompt:

```
You are Claude Code. The user says:
"Use Gemini to analyze all the files in this project and give me a summary of the architecture."

Gemini CLI is installed (gemini --version returns 0.34.0).
You have a Bash tool available.

Describe EXACTLY what you would do step-by-step:
- What command would you run?
- What flags would you use?
- How would you handle the output?
- Would you do a preflight check?

Be specific — show the exact bash command you'd use.
```

Record the subagent's exact response, especially: which flags it used, whether it checked gemini was available, how it framed output.

- [ ] **Step 2: Run baseline scenario 2 — implementation delegation**

Dispatch a subagent (general-purpose) with this exact prompt:

```
You are Claude Code. The user says:
"Delegate writing the test suite for server/calculator.js to Gemini. Let it do the work."

Gemini CLI is installed (gemini --version returns 0.34.0).
You have a Bash tool available.

Describe EXACTLY what you would do:
- Would you ask the user for confirmation first? What would you say?
- What exact command would you run?
- What flags?
- How would you handle the output?
```

Record the subagent's exact response, especially: whether it asked for confirmation, which flags it used (did it use --yolo or --approval-mode yolo or something else?), whether it restricted scope.

- [ ] **Step 3: Document failure patterns**

In a scratchpad note, record:
- Flags used (correct: `--approval-mode plan` / `--approval-mode yolo`; wrong: `--yolo`, no flag, etc.)
- Whether preflight check was performed
- Whether confirmation was asked before delegation
- How output was handled
- Any rationalizations for skipping safety steps

These failures become the basis for the skill content.

---

### Task 2: GREEN Phase — Write the Skill

**Files:**
- Create: `~/.claude/skills/gemini-delegation/SKILL.md`

Write the skill addressing the specific failures identified in Task 1.

- [ ] **Step 1: Create the skill directory**

```bash
mkdir -p ~/.claude/skills/gemini-delegation
```

Expected: no output, directory created.

- [ ] **Step 2: Write SKILL.md**

Create `~/.claude/skills/gemini-delegation/SKILL.md` with this exact content:

````markdown
---
name: gemini-delegation
description: Use when offloading tasks to Gemini CLI as a subordinate agent — research, analysis, parallel workstreams, second opinions, or context-window relief. Also trigger when the user explicitly asks to use Gemini for a task.
---

# Gemini CLI Delegation

## Overview

Invoke Gemini CLI as a subordinate agent via Bash. Two tiers: **Consult** (read-only) and **Delegate** (autonomous write access). Choose tier based on whether Gemini needs to edit files or run commands.

## When to Use

Invoke Gemini when any of these apply:
- **Context-window relief** — task would consume significant context you need elsewhere
- **Parallelism** — two or more independent tasks can run simultaneously
- **Second opinion** — review your own draft code, plan, or analysis
- **Large-scale analysis** — whole codebase scan, dep audit, doc summarization
- **Explicit user request** — "use Gemini for this"

Do **not** invoke for small focused tasks you can handle inline, or when composing the handoff prompt costs more than doing the task directly.

## Preflight

Before the **first** Gemini invocation in a session, verify the CLI is available:

```bash
gemini --version
```

If this fails, tell the user: "Gemini CLI not found — install it and ensure it's on PATH." Do not proceed with delegation.

## Two-Tier Model

### Consult Tier (read-only)

Use for: research, analysis, summarization, Q&A, code review, second opinions.

`--approval-mode plan` enforces read-only at the CLI level — Gemini cannot edit files or run commands even if the prompt implies it should.

```bash
# Basic
gemini -p "<prompt>" --approval-mode plan --output-format text

# With directory context
gemini -p "<prompt>" --approval-mode plan --include-directories /path/to/dir --output-format text

# With piped content (single files or focused excerpts)
cat file.txt | gemini -p "<prompt>" --approval-mode plan --output-format text
```

### Delegate Tier (autonomous write access)

Use for: code generation, file editing, running commands, implementation tasks.

```bash
# Basic
gemini -p "<prompt>" --approval-mode yolo --output-format text

# With directory context
gemini -p "<prompt>" --approval-mode yolo --include-directories /path/to/dir --output-format text
```

**Required: confirm with the user before every Delegate invocation.** Say:

> "I'm going to delegate [X] to Gemini with write access. It will [specific actions, e.g., 'edit files in client/src']. Proceed?"

Wait for explicit approval. **Never invoke `--approval-mode yolo` silently.**

**No parallel Delegate invocations** — two concurrent write-access agents can produce conflicting edits. Execute Delegate tasks one at a time.

## Tier Selection

| Task type | Tier | Flag |
|---|---|---|
| Research, analysis, summarization, Q&A | Consult | `--approval-mode plan` |
| Code review, audit, second opinion | Consult | `--approval-mode plan` |
| Code generation, file editing, commands | Delegate | `--approval-mode yolo` |
| Explicit implementation delegation | Delegate | `--approval-mode yolo` |

## Directory Context

- Pass **project root** by default
- Pass a **specific subdirectory** when the task is scoped to it
- Pass **multiple directories** only when the task explicitly requires cross-tree context
- Prefer `--include-directories` for multi-file directory context; pipe (`cat file | gemini -p`) for single files or focused excerpts

## Handoff Prompt Guidelines

A focused handoff prompt:
- States the task in one sentence
- Includes relevant file paths, error messages, or constraints
- Specifies expected output format (e.g., "return a bullet list", "output only the corrected code")
- For Delegate tier: states what Gemini is and isn't allowed to touch

## Output Handling

**Default: Synthesize** — read output, distill key findings, present a summary.

| Mode | When to use | How |
|---|---|---|
| **Synthesize** | Research, analysis, Q&A | Read output, distill key findings, present summary |
| **Pass-through** | Review, second opinion | Prefix with `Gemini (Consult):` and wrap in blockquote |
| **Act-on-it** | Code review → fixes, plan critique → revisions | Apply or respond to Gemini's findings |

Use Pass-through only when Gemini's exact wording is the value (e.g., a formatted review).
Use Act-on-it only when you have an artifact (code, plan) to update.

## Parallel Consult Invocations

When two or more independent Consult-tier tasks can run simultaneously, fire multiple Bash tool calls in the same response — one `gemini -p` per task. Collect all results before acting on them.

## Error Handling

- Non-zero exit or empty output → report to user, do not silently fail
- Gemini output contradicts your plan → surface the conflict, let the user decide
- Large-scale analysis calls may take 30–120 seconds — warn the user upfront
````

- [ ] **Step 3: Verify the file was written**

```bash
cat ~/.claude/skills/gemini-delegation/SKILL.md | head -20
```

Expected: YAML frontmatter and start of skill content.

---

### Task 3: GREEN Phase — Test With Skill Loaded

Run the same two scenarios from Task 1, this time including the full SKILL.md content in the subagent's context. Verify the failures are corrected.

- [ ] **Step 0: Read the skill content**

Before dispatching test subagents, read the written skill into memory:

```bash
cat ~/.claude/skills/gemini-delegation/SKILL.md
```

Use this full content verbatim in the prompts below (replacing the `[SKILL CONTENT]` placeholder).

- [ ] **Step 1: Run scenario 1 with skill**

Dispatch a subagent (general-purpose) with this prompt (substitute full SKILL.md content for `[SKILL CONTENT]`):

```
You have the following skill available:

[SKILL CONTENT]

---

You are Claude Code. The user says:
"Use Gemini to analyze all the files in this project and give me a summary of the architecture."

Gemini CLI is installed (gemini --version returns 0.34.0).
You have a Bash tool available.

Show the exact steps you would take, including the exact bash command.
```

**Pass criteria:**
- Runs `gemini --version` preflight (or notes it would)
- Uses `--approval-mode plan` (not `--yolo`, not no flag)
- Uses `--output-format text`
- Passes project root via `--include-directories`
- Synthesizes or summarizes the output

- [ ] **Step 2: Run scenario 2 with skill**

Dispatch a subagent (general-purpose) with this prompt (same full SKILL.md content for `[SKILL CONTENT]`):

```
You have the following skill available:

[SKILL CONTENT]

---

You are Claude Code. The user says:
"Delegate writing the test suite for server/calculator.js to Gemini. Let it do the work."

Gemini CLI is installed (gemini --version returns 0.34.0).
You have a Bash tool available.

Show the exact steps you would take.
```

**Pass criteria:**
- Asks user for explicit confirmation before invoking
- Confirmation message names what will be delegated and what Gemini will do
- Uses `--approval-mode yolo` (not `--yolo`, not no flag)
- Does not fire silently
- Passes `server/` via `--include-directories` (task is scoped to that subdirectory, not the full project root)

- [ ] **Step 3: Record results**

Note whether each criterion passed or failed. If all pass → proceed to Task 4. If any fail → identify the gap in the skill content and fix SKILL.md, then re-test.

---

### Task 4: REFACTOR Phase — Close Loopholes

- [ ] **Step 1: Review test results from Task 3**

For any failing criteria, identify the specific line in the skill that the subagent misread or ignored.

- [ ] **Step 2: Update SKILL.md if gaps found**

Common gaps to watch for:
- Subagent uses `--yolo` instead of `--approval-mode yolo` → add explicit warning in skill
- Subagent skips preflight → make preflight section more prominent (move earlier or add bold)
- Subagent skips confirmation → add rationalization table with "I'll just run it, it's faster" → "No. Ask first."
- Subagent picks wrong output mode → reinforce the Default rule
- Subagent picks Consult (`--approval-mode plan`) for a task that requires Delegate (e.g., "write the test suite" treated as analysis) → reinforce the tier selection table with explicit examples of implementation tasks

Edit `~/.claude/skills/gemini-delegation/SKILL.md` to address any gaps.

- [ ] **Step 3: Re-run failing scenarios**

Re-dispatch only the scenarios that failed in Task 3. Verify they now pass with the updated skill.

- [ ] **Step 4: Final check — word count**

```bash
wc -w ~/.claude/skills/gemini-delegation/SKILL.md
```

Target: under 500 words for the body (excluding frontmatter). If over, identify what can be compressed without losing meaning.
