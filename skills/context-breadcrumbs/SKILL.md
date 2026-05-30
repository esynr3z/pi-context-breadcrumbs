---
name: context-breadcrumbs
description: Defines a portable policy for creating, reviewing, and maintaining concise path-scoped context files such as AGENTS.md, AGENTS.override.md, and CLAUDE.md. Use when asked to add or update repository agent guidance, local policies, or onboarding breadcrumbs.
---

# Context Breadcrumbs

Use this skill when creating, reviewing, moving, or deleting context breadcrumb files. A context breadcrumb file is short path-scoped guidance for coding agents. It should add the local context, rules, gotchas, and workflow hints needed to work safely in that area of the repository.

A breadcrumb is not a directory map, documentation copy, changelog, task list, or second README. If the useful information already lives in authoritative documentation or code, point to the source of truth and add only the practical agent-facing notes that are missing there.

## Core policy

Treat each context breadcrumb file as supplemental local instructions. Keep it concise, specific, and non-duplicative. Prefer durable guidance over descriptive prose: what to respect, what to avoid, what commands matter, what contracts are authoritative, and what assumptions are dangerous in this subtree.

Use the filenames configured by the project. Common filenames are `AGENTS.md`, `AGENTS.override.md`, and `CLAUDE.md`. If the project has no stated preference, prefer `AGENTS.md` as the normal breadcrumb filename. Do not create multiple files in the same directory with conflicting guidance. If compatibility requires more than one filename, make one canonical and keep the others minimal or clearly scoped.

Add a local breadcrumb file only when a directory needs non-obvious guidance that materially improves agent behavior. Do not create breadcrumbs merely because a directory exists or contains tracked files. Skip leaf, one-off, generated, vendor-style, cache, build-output, or self-evident directories unless local instructions are needed for safety or workflow.

## What each breadcrumb should contain

Each breadcrumb should be useful when read in isolation for work in its directory. Include only sections that carry real value for that area. Common sections are:

- `Scope` — one short sentence naming the files or work covered, only when the scope is not obvious from the path.
- `Source of Truth` — authoritative docs, configs, schemas, tests, generated-file contracts, or owner files that should be checked instead of copying their content here.
- `Local Guidance` — area-specific conventions, invariants, API boundaries, review expectations, or integration notes that are easy to miss.
- `Workflow` — local commands, fixtures, test targets, generators, or setup details that differ from the repository default.
- `Safety` — files not to edit by hand, expensive commands, migration risks, binary assets, secrets handling, or other subtree-specific hazards.

Write file and directory paths as plain code spans, for example `docs/architecture.md`. Do not use full Markdown links for local repository paths. Resolve every path relative to the breadcrumb file that contains it, not relative to the repository root.

Do not maintain lists of neighboring breadcrumbs. The extension discovers applicable breadcrumb files; the breadcrumb content should focus on policies and onboarding hints for the current area.

## Maintenance workflow

Before editing breadcrumbs, inspect the existing relevant breadcrumbs and the canonical docs, configs, tests, or source files for the target area. Preserve established tone and section naming when it remains useful, but remove stale map-like lists, copied documentation, generic filler, and advice that no longer changes agent behavior.

When adding a breadcrumb, keep it small and scoped to non-obvious local guidance. Do not update parent breadcrumbs just to point to the new file. When moving or deleting files, update or remove any stale source-of-truth references or local guidance that mentioned them.

Verify every referenced path after editing. Remove stale references. If a useful source of truth does not exist yet, say so explicitly rather than leaving a path that looks valid.

## Content guidelines

Keep breadcrumbs short enough to be read quickly. Strong breadcrumbs usually contain a few precise bullets, not a prose tour. Prefer commands, invariants, and warnings over summaries of what the code already says.

Cut aggressively:

- directory listings and parent/child breadcrumb indexes;
- copied README, design-doc, or API-reference text;
- generic repository rules already stated by a broader breadcrumb;
- obvious statements such as "this directory contains tests" when the path already says so;
- stale onboarding notes, completed TODOs, release notes, and task status;
- speculative advice without a source or clear reason.

Do not put secrets, credentials, private environment values, or large generated content in breadcrumbs. Do not use breadcrumbs as task trackers, changelogs, release notes, or long-form design documents. Point to those sources instead when they are the source of truth.
