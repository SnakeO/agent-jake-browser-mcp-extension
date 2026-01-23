This file is a merged representation of the entire codebase, combined into a single document by Repomix.

# File Summary

## Purpose
This file contains a packed representation of the entire repository's contents.
It is designed to be easily consumable by AI systems for analysis, code review,
or other automated processes.

## File Format
The content is organized as follows:
1. This summary section
2. Repository information
3. Directory structure
4. Repository files (if enabled)
5. Multiple file entries, each consisting of:
  a. A header with the file path (## File: path/to/file)
  b. The full contents of the file in a code block

## Usage Guidelines
- This file should be treated as read-only. Any changes should be made to the
  original repository files, not this packed version.
- When processing this file, use the file path to distinguish
  between different files in the repository.
- Be aware that this file may contain sensitive information. Handle it with
  the same level of security as you would the original repository.

## Notes
- Some files may have been excluded based on .gitignore rules and Repomix's configuration
- Binary files are not included in this packed representation. Please refer to the Repository Structure section for a complete list of file paths, including binary files
- Files matching patterns in .gitignore are excluded
- Files matching default ignore patterns are excluded
- Files are sorted by Git change count (files with more changes are at the bottom)

# Directory Structure
```
.claude/
  plans/
    http-transport-mcp-architecture.md
icons/
  agent-jake-logo.svg
  icon128.png
  icon128.svg
  icon16.png
  icon48.png
scripts/
  generate-icons.js
src/
  background/
    tools/
      index.ts
      schemas.ts
      utils.ts
    activity-log.ts
    api-client.ts
    auth-service.ts
    connection-state.ts
    index.ts
    reverb-client.ts
    sw-polyfill.ts
    tab-manager.ts
    tool-handlers.ts
    ws-client.ts
  constants/
    debugger.ts
    highlight.ts
    index.ts
    keys.ts
    timeouts.ts
  content/
    aria/
      index.ts
      roles.ts
    aria-tree.ts
    index.ts
    selector.ts
  popup/
    components/
      ActivityEntry.vue
      ActivityLog.vue
      ActivityModal.vue
      AuthForm.vue
      ConnectionStatus.vue
      TabSelector.vue
      UserCard.vue
    composables/
      useFormatting.ts
    constants/
      activityFilters.ts
    stores/
      activity.ts
      auth.ts
      index.ts
      status.ts
    styles/
      base.css
      variables.css
    types/
      index.ts
    App.vue
    index.html
    main.ts
  types/
    activity.ts
    config.ts
    messages.ts
  utils/
    logger.ts
  env.d.ts
test-results/
  .last-run.json
tests/
  unit/
    aria/
      roles.test.ts
    background/
      api-client.test.ts
      auth-service.test.ts
      reverb-client.test.ts
    tools/
      keyboard.test.ts
      utils.test.ts
    tool-schemas.test.ts
  extension.spec.ts
.gitignore
LICENSE
manifest.json
package.json
playwright.config.ts
README.md
repomix.config.json
tsconfig.json
vite.config.ts
vitest.config.ts
```
