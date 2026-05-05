---
name: context-breadcrumbs
description: Defines a portable policy for creating, reviewing, and maintaining path-scoped context breadcrumb files such as AGENTS.md, AGENTS.override.md, and CLAUDE.md. Use when asked to add or update repository agent context, nested context files, or breadcrumb navigation maps.
---

# Context Breadcrumbs

Use this skill when creating, reviewing, moving, or deleting context breadcrumb files. A context breadcrumb file is a short local map for coding agents. It helps an agent enter a directory, find the nearest relevant policy and source-of-truth files, and continue to deeper local maps when they exist.

## Core policy

Treat each context breadcrumb file as a local map, not a full manual. Keep it concise and non-duplicative. Prefer paths to canonical docs, configs, tests, and source files over copied explanations.

Use the filenames configured by the project. Common filenames are `AGENTS.md`, `AGENTS.override.md`, and `CLAUDE.md`. If the project has no stated preference, prefer `AGENTS.md` as the normal breadcrumb filename. Do not create multiple files in the same directory with conflicting guidance. If compatibility requires more than one filename, make one canonical and keep the others minimal or clearly scoped.

Add a local breadcrumb file only for important navigation nodes or when the directory needs agent guidance that is not obvious from its parent map. Do not create breadcrumb files just because a directory has tracked files. Skip leaf, one-off, generated, vendor-style, cache, build-output, or self-evident directories unless a local map materially improves navigation or workflow safety.

## What each breadcrumb should contain

Each local breadcrumb that exists should include paths:

- back to the nearest parent breadcrumb, or to the repository-root breadcrumb when there is no nearer parent;
- sideways to canonical source-of-truth docs, configs, tests, schemas, or source files for that area;
- forward to child directories that also define breadcrumb files.

Write file and directory paths as plain code spans, for example `docs/AGENTS.md`. Do not use full Markdown links for breadcrumb paths. Resolve every path relative to the breadcrumb file that contains it, not relative to the repository root.

Use short section names that fit the repository. Common sections are `Parent Map`, `Source of Truth`, `Local Notes`, and `Child Maps`. For a repository-root breadcrumb, use `Start Here` and `Child Maps` instead of `Parent Map`.

## Maintenance workflow

Before editing breadcrumbs, inspect the existing network: read the nearest parent breadcrumb, list child breadcrumbs below the target directory, and identify canonical docs or files for the area. Preserve established section naming and tone unless it is confusing.

When adding a breadcrumb, also update the nearest parent breadcrumb so it points forward to the new child. When moving or deleting a directory with a breadcrumb, update parent, sibling, and child path references that pointed to it. When canonical docs move, update breadcrumb paths instead of copying the moved content into breadcrumbs.

Verify every referenced path after editing. Remove stale references. If a useful target does not exist yet, say so explicitly rather than leaving a path that looks valid.

## Content guidelines

Keep breadcrumbs short enough to be read quickly. Include local safety rules only when they are genuinely directory-specific, such as generated files to avoid, binary files not to read, required commands for that subtree, or authoritative contracts that override nearby assumptions.

Do not put secrets, credentials, private environment values, or large generated content in breadcrumbs. Do not use breadcrumbs as task trackers, changelogs, release notes, or long-form design documents. Point to those sources instead.
