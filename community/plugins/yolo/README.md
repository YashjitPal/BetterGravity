# YOLO

Sets Antigravity's native **allow-all execution policy before a turn starts**.
This covers the permission requests that can still interrupt Turbo mode,
including MCP tools, visiting and reading websites, terminal commands, file
permissions, browser actions, and plan review.

Enable **YOLO** in **Settings → BetterGravity → Plugins**, with developer mode
on. The policy applies to the next message, continuation, queued-message send,
or retry. A turn already running keeps the configuration it started with;
submit a new turn to use the changed policy.
Requests that reuse a previous server configuration also retain that policy.

Switching YOLO off restores normal configuration for subsequent requests.
Already-started turns can finish with their existing policy. The settings gear
shows how many execution requests were configured during this session.

## Native integration

YOLO sets `autoAllowAllInteractions` and
`autoInteractionBehavior = AUTO_INTERACTION_BEHAVIOR_ALLOW_ALL` in the native
executor's tool configuration. It also selects eager command execution,
automatic browser execution, and automatic artifact review. These settings are
applied after the UI constructs its configuration and before transmission to
Antigravity's local language server.

The implementation supports Connect JSON, protobuf, framed Connect/gRPC-Web,
and the app's WebSocket transport, including sockets already open when YOLO is
enabled. Ordinary sends, queue flushes, retries, custom agent configurations,
and battle-mode requests are covered. Protocol fields were verified against
Antigravity **2.12.2**.

YOLO has no conversation observer, polling loop, approval-service calls, or
button clicks. It does not rewrite prompts, commands, model choices, saved
permission rules, or sandbox settings. Unsupported payload formats continue
with their normal configuration and are reported in the settings status.
Custom agent source references are preserved; YOLO only updates execution
configurations present in a request.

## BetterGravity integrations

- **In Built Browser:** the matching BetterGravity runtime checks YOLO before
  requesting website or device permissions. JavaScript alerts and confirmations
  are handled in the native browser. Updating the runtime requires one normal
  Antigravity restart; later YOLO toggles take effect live.
- **Computer Use 1.0.1+:** its application-permission check follows YOLO before
  creating an approval dialog.

These integrations leave saved permission lists intact, so disabling YOLO
restores the user's previous preferences. Browser Stop and manual handoff
remain available.

Login flows, questions requiring information, operating-system dialogs, and
policies enforced by a server or organization still require their own handling.
