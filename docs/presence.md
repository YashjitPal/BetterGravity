# Discord Rich Presence

The **Discord Rich Presence** plugin shows on your Discord profile whether the
Antigravity agent is working or idle, and for how long.

It sends nothing identifying. It never reads a project name, a conversation
title, a model, or any message text — only whether a stop control exists on
screen, which is how it knows the agent is running.

## Setting it up

Discord needs an *application* to attach a presence to, and it has to be yours:
the application is what supplies the name and artwork that appear on your
profile. Making one takes about a minute and needs no review or approval.

1. Open [discord.com/developers/applications](https://discord.com/developers/applications)
   and press **New Application**. Name it whatever you want the top line of your
   status to read — **Antigravity** is the obvious choice, and it is the line
   Discord shows in bold.
2. On **General Information**, copy the **Application ID**.
3. In Antigravity, open **Settings → BetterGravity → Plugins**, switch on
   **Discord Rich Presence**, and press the gear beside it. Paste the ID into
   **Discord application ID**.

The presence appears within a few seconds. Discord has to be running on the same
machine; it will not work with Discord in a browser tab, which has no local
socket to connect to.

### Artwork

Optional, but it is the difference between a status with a picture and one
without.

On the application's **Rich Presence → Art Assets** page, upload a 512×512 image
and name it `antigravity`. That name is what the plugin's **Artwork key**
setting refers to, so if you name the asset something else, put that name in the
setting instead. Clearing the setting shows no image at all.

Discord caches art assets aggressively, so a newly uploaded image can take
several minutes to start appearing.

## Options

| Option | What it does |
| --- | --- |
| **Discord application ID** | The application to attach the presence to. Presence stays off until this is set. |
| **When idle** | Whether to keep showing Antigravity once the agent stops, or hide the presence entirely. |
| **Elapsed timer** | Count from when the current state began, from when Antigravity opened, or not at all. |
| **Artwork key** | The name of an uploaded art asset. Empty means no image. |

## When it says nothing is connected

The plugin writes its connection state to `runtime.log`, in
`%APPDATA%\BetterGravity`. The states are:

| State | What it means |
| --- | --- |
| `off` | No application ID is set, or the plugin is disabled. |
| `connecting` | A socket is open and Discord has not answered yet. |
| `connected` | Working. The log line names the signed-in account. |
| `unavailable` | Discord is closed, or refused the connection. |

`unavailable` is normal whenever Discord is not running — the runtime keeps
retrying, backing off to once a minute, and reconnects by itself when Discord
comes back. If it persists while Discord *is* running, the message on the log
line says why; **Invalid client ID** means the application ID was mistyped.

Nothing here reaches the network. The connection is a local socket on your own
machine, and the only thing that leaves it is the text described above.

## Writing your own

The capability behind this is [`plugin.presence`](plugin-api.md#pluginpresence),
so a plugin can show whatever it likes. The plugin itself is about eighty lines
and is a reasonable place to start:
[`community/plugins/discord-rich-presence`](../community/plugins/discord-rich-presence).

Why it needs the runtime rather than being pure page code is covered in
[the API reference](plugin-api.md#pluginpresence).
