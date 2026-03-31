# n8n-nodes-dns

This directory contains the project's planning data as markdown files, managed by Kontext.

## Structure

```
kontext/
  kontext.md            # This file
  docs/
    *.md                # Design documents (plain markdown, no frontmatter)
  epics/
    *.md                # Epic definitions with YAML frontmatter
  stories/
    *.md                # One file per story, YAML frontmatter + body
```

## Story IDs

Stories use the format `KNX-XXXXX` (e.g., `KNX-00001`). These IDs are referenced in commit messages and cross-story dependencies. New stories get the next available number.

## Frontmatter Schema

### Stories (`stories/*.md`)

```yaml
id: KNX-XXXXX          # Unique story ID
title: "Short title"    # Display title
epic: epic-id           # Parent epic reference
status: backlog         # One of: backlog, in_progress, review, done
priority: high          # high or medium
tags: [rust, core]      # Freeform tags for filtering
depends_on: [KNX-00001] # Story IDs that must be done before this one can start
```

### Epics (`epics/*.md`)

```yaml
id: epic-id             # Unique epic ID
title: "Epic Title"     # Display title
status: active          # active or planning
color: "#4A90D9"        # Color used in UI badges
```

## Design Documents (`docs/*.md`)

Design documents are plain markdown files without YAML frontmatter. They describe architecture, specifications, and design decisions. Keep code examples to a minimum — focus on intent, constraints, and trade-offs rather than implementation details. Good design docs explain *why* over *how*.

## Configuration (`.kontext/config.yaml`)

Board columns are configured in `.kontext/config.yaml` at the repository root:

- `board.columns` — ordered list of kanban column names
