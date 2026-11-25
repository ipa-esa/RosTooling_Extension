# Rebuild the documentation site for the 2026 tooling and add the VS Code extension

## Summary

The site was still the Eclipse-era documentation on Jekyll. This change moves it to Sphinx, rewrites the pages for RosTooling 3.2–3.6, and adds the documentation of the VS Code extension (RosTooling_Extension) next to it. 116 files, 18 commits, one per phase plus follow-ups.

## What changes

**Site and navigation**
- Jekyll → Sphinx with MyST Markdown and the Read the Docs theme (`conf.py`, pinned `requirements.txt`). Pages stay Markdown.
- Sidebar, breadcrumb, Previous/Next and search come from the theme; no custom templates.
- `docs.yml` builds with warnings as errors, runs the link check (non-blocking) and deploys to GitHub Pages.
- Old URLs keep working: moved pages redirect, archived pages are in `docu/old/` and out of the sidebar.

**RosTooling pages**
- Languages: package, system, parameters, communication objects, validation (new).
- Code generation: `.ros2` wrappers (replaces the ROSSDL page), system generation, target distributions (new).
- Plugins (Preview): concepts, blocks, loading and trust, development, BehaviorTree example.
- Integration: LSP commands, GLSP diagram server, architecture overview (new). What's new in 2026 (new).
- Tutorials rewritten for VS Code; Eclipse steps kept in tabs.
- Installation, known issues and "Building, testing and releasing" rewritten. Eclipse pages marked legacy, plus a short page on running a plugin inside Eclipse.

**VS Code Extension (new, `vscode/`)**
- Ten pages: overview, getting started, editing, Studio, auto-connect, generate and build, catalogue, plugins, MCP and agents, reference. Screenshots and GIFs come from the real Studio (`tools/screenshots/`).

**Tooling**
- `tools/check_examples.py` runs every marked example through the real language server. 56 example groups pass against the current development server.

## Needs a newer RosTooling than the current release

These are documented as working, each with a note on its page: Base64 values, `dependencies:` on another package model, sized and bounded array fields, `default:` of a system parameter, importing a catalogue node in the Studio, and the parameter file of a namespaced node. The checker skips the ones the released server rejects. Remove the notes and `skip=` markers once a release contains them.

## Review notes

- Plugin pages carry a "Preview" label because the plugin system is unreleased.
- The Eclipse update site only offers feature 3.0.0 (April 2024). The Installation page says so.
- Seven dead external links remain in archived pages. No live page has a broken link.
- Not in this change: trimming the READMEs of RosTooling and RosTooling_Extension to point at the site (needs the published URL).

## Before merging

Set Settings → Pages → Source to **GitHub Actions** in the repository. The workflow deploys on pushes to `main`.

## Test plan

- [ ] `pip install -r requirements.txt && sphinx-build -W --keep-going -b html . _build/html` passes
- [ ] The `docs` workflow is green and the deployed site opens
- [ ] Old URLs such as `docu/rossdl.html` redirect
- [ ] Sidebar, breadcrumb and Previous/Next work on a tutorial
