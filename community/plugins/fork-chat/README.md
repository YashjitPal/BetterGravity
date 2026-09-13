# Fork Chat

Fork any conversation from any assistant response or sidebar thread into a new branch or workspace, matching Codex and Claude Code.

## Features

- **Fork from Any Response**: Adds a "Fork from this response" button to each assistant response's action bar. The new branch includes that response and everything before it, excluding later messages. Sent messages keep their Copy and Undo controls.
- **Fork During Active Work**: Earlier completed responses can be forked while the original conversation continues running. If the host requires an idle source, Fork Chat creates a snapshot of the selected history and its context. Unfinished background work stays in the original conversation.
- **Sidebar Context Menu**: Right-click or open the kebab menu on any conversation row in the sidebar to fork that thread with a single click.
- **Global Fork Picker Modal**: A dedicated "Fork Chat" sidebar button opens a searchable modal to browse all conversations, select a destination workspace, and fork immediately.
- **Target Workspaces**:
  - **Current Workspace**: Keeps the forked thread inside the current project folder.
  - **Shared Workspace**: Creates an isolated Git worktree branch for safe experimentation without modifying the working directory.
- **Seamless Navigation**: Automatically switches the view into your newly created conversation branch.

## Settings

- **Default fork workspace**: Choose whether new forks default to the current workspace or an isolated Git worktree.
- **Show fork button on every response**: Toggle whether fork buttons are attached to every assistant response or only the latest reply.
- **Quick fork on click**: Bypass the workspace confirmation popover to fork immediately into the default workspace.
