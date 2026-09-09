# Fork Chat

Fork any conversation from any message turn or sidebar thread into a new branch or workspace, matching Codex and Claude Code.

## Features

- **Fork from Any Message**: Injects a sleek "Fork from this message" button on every turn's action bar in the conversation view. Branch off at any point in history.
- **Sidebar Context Menu**: Right-click or open the kebab menu on any conversation row in the sidebar to fork that thread with a single click.
- **Global Fork Picker Modal**: A dedicated "Fork Chat" sidebar button opens a searchable modal to browse all conversations, select a destination workspace, and fork immediately.
- **Target Workspaces**:
  - **Current Workspace**: Keeps the forked thread inside the current project folder.
  - **Shared Workspace**: Creates an isolated Git worktree branch for safe experimentation without modifying the working directory.
- **Seamless Navigation**: Automatically switches the view into your newly created conversation branch.

## Settings

- **Default fork workspace**: Choose whether new forks default to the current workspace or an isolated Git worktree.
- **Show fork button on every message**: Toggle whether fork buttons are attached to every message turn or only the latest reply.
- **Quick fork on click**: Bypass the workspace confirmation popover to fork immediately into the default workspace.
