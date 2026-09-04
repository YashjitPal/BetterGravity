# A Gemini key of your own

The **Custom Gemini API Key** plugin sends Antigravity's chat through a Gemini
API key you supply, instead of the subscription it ships with. Everything else
about the editor is unchanged: the same chat panel, the same model picker, the
same agent.

It is worth having for two reasons. A key of your own has its own quota, so a
rate limit on the bundled subscription stops being your problem. And the public
API exposes things the bundled one does not — the model's own thinking, for one,
which this can pass straight through to the interface.

Nothing about your prompts changes shape. Requests are translated from
Antigravity's internal protocol into the public Gemini API and back, on your own
machine; the request log, if you switch it on, records what was asked for and how
it went, never what was in it.

## What it actually does

Antigravity's chat does not talk to the public Gemini API. It talks to a Google
service of its own, over a protocol of its own, at an address its language server
is given on the command line.

So BetterGravity becomes that address. It generates a certificate authority,
serves an HTTPS listener on `127.0.0.1`, and rewrites that one command-line
argument as the language server starts. Requests arriving there are translated
into public API calls made with your key, and the replies are translated back
into the shape the editor expects.

Two consequences follow from that, and between them they explain everything this
feature does on your behalf:

- **The certificate has to be trusted**, because the language server checks it
  like any other client. BetterGravity puts its authority into your own
  certificate store while a plugin asks for the translator — your account only, no
  administrator prompt, nothing else on the machine touched — and takes it back
  out at the first launch where nothing does. Until it is in there the argument is
  left exactly as Antigravity wrote it and chat carries on through Google, which
  is much better than a refused handshake and no chat at all.
- **A restart is needed once**, because the address is an argument to a process
  that is already running. Nothing can be done about that from inside the
  running editor.

## Setting it up

1. Open [aistudio.google.com/apikey](https://aistudio.google.com/apikey) and
   create a key. The free tier is enough to try this with.
2. In Antigravity, open **Settings → BetterGravity → Plugins**, turn on
   **Developer mode** if it is not already on, switch on **Custom Gemini API
   Key**, and press the gear beside it.
3. Paste the key into **Gemini API key**.
4. Restart Antigravity.

That is all of it. Switching the plugin on is what installs the certificate, so
there is nothing to press and nothing to authorise twice; a notification tells you
when the restart is the only thing left.

If you would rather see the certificate for yourself, it is under **Certificates -
Current User → Trusted Root Certification Authorities** in `certmgr.msc`, issued
to *BetterGravity Local Authority*. `runtime.log` prints its SHA-1 thumbprint at
every launch.

### Undoing it

Switch the plugin off. Chat is back on the bundled subscription immediately — the
listener stays up until the editor closes, because the address the running
language server was given cannot be unwritten, but from that moment it forwards
requests untranslated instead of using your key. At the next launch nothing asks
for the translator, so the authority comes out of your certificate store and the
language server is left pointed at Google as it always was.

## A different address

**Base URL** is where your key is spent. Empty means
`https://generativelanguage.googleapis.com`, which is what almost everyone wants.

Set it if your key belongs to something else that speaks the same API — a relay
of your own, a gateway your workplace puts in front of Google, something running
on your own machine. The standard `/v1beta/...` path is appended to whatever you
give, so `https://relay.example/gemini` is asked for
`https://relay.example/gemini/v1beta/models/...`.

`http://` is accepted for `localhost` and `127.0.0.1` only; anywhere else it
would put your key on the wire in clear text, so it is refused. Anything that
cannot be read as an address is refused the same way: requests go to Google, and
the plugin says why rather than leaving you with no chat.

## Options

| Option | What it does |
| --- | --- |
| **Gemini API key** | The key everything runs on. Chat stays on Antigravity's own subscription until this is set. |
| **Base URL** | Where the key is spent. Empty means Google's own API. |
| **Stream replies** | Shows the answer as it is written, the way the editor does on its own credentials. |
| **Show the model's thinking** | Passes thinking through instead of dropping it. Costs nothing extra; it is generated either way. |
| **Keep a request log** | One line per request, described below. |

## The four states

Underneath, the feature is always in one of four states. It writes each one to
`runtime.log` as it changes, and turns the ones that want something from you into
a notification:

| State | What it means |
| --- | --- |
| **routing** | Working. Chat is going through your key, and the line says where to. |
| **listening** | Everything is in place; the language server that is running was started before it was. Restart. |
| **off** | Deliberately not translating — no key is set, or the plugin is switched off. Chat works, on the bundled subscription. |
| **blocked** | Something is wrong with the translator itself, and the line with it says what. |

Chat keeps working in all four. There is no state in which this feature stops
you talking to the agent — every path that cannot translate forwards instead.

## Where your key lives

In `storage.json` under `%APPDATA%\BetterGravity`, with the plugin's other
settings, in plain text — the same place and the same way as every other plugin
setting. The **Gemini API key** field is a password field, so it is not readable
over your shoulder, but that is all that hiding buys.

From there it goes to Google's API — or to the **Base URL**, if you set one — and
nowhere else. It is never written to `runtime.log`, never written to the request
log, and never part of a status, which is why the panel can show a status and a
plugin can log one without either leaking it.

If you keep a clone of this repository, note that `.gitignore` already excludes
`storage.json`, `trust.json`, `*.jsonl`, and every certificate and key extension,
so copying runtime state into a working tree cannot commit a key by accident.

## The request log

Off by default. Switched on, it writes one JSON object per line to
`gemini\api-calls.jsonl` under `%APPDATA%\BetterGravity`:

```json
{"ts":"2026-09-04T08:00:00.000Z","mode":"stream","srcEnum":"MODEL_GEMINI_3_PRO","model":"gemini-3-pro-preview","thinkingLevel":"low","thinkingBudget":null,"includeThoughts":false,"status":200,"latencyMs":1234}
```

Which model was asked for, which public model it became, how long it took, and
what came back. Never a prompt, never a reply. Anything an upstream error quoted
back is redacted before it is written, so a Google error message that repeats a
key cannot put one on your disk. The file rotates at 2 MB, keeping one previous
generation.

## When something is wrong

*The certificate can only be installed on Windows* — the translator itself is
portable, but adding a root certificate is not, and only the Windows route is
implemented.

*Windows did not accept the certificate* — whatever the certificate store said
comes through in its own words. `runtime.log` has the rest of it.

*A local port could not be opened for the translator* — something is very wrong
with loopback networking; `runtime.log` has the underlying error.

*Restart Antigravity to send its chat through your key* — exactly what it says,
and it appears once per launch at most.

A key the API rejects is not on that list, because it does not need to be:
whatever Google — or your base URL — says about it arrives in the chat panel as
the reply, in its own words.

For anything else, `runtime.log` carries a `gemini:` line for every state change,
including the thumbprint it minted and the port it bound.

## Writing your own

The capability behind this is [`plugin.gemini`](plugin-api.md#plugingemini), and
the plugin itself is a settings panel and very little else —
[`community/plugins/gemini-api-key`](../community/plugins/gemini-api-key). The
translator, the listener, and the endpoint rewrite are in the runtime, because
they have to be in place before any plugin script exists to ask for them; a
manifest that declares `"gemini": true` is what arms them at launch.
