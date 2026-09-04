/**
 * The Gemini translator, assembled: certificate material, the loopback listener,
 * the language server's endpoint, and the status the settings panel reads.
 *
 * The order things happen in is the whole design. `arm` runs from `activate()`,
 * before Electron is ready and so before Antigravity spawns its language server;
 * it mints the certificate, starts listening, and wraps `spawn`. By the time the
 * language server starts there is a port to point it at. Nothing here waits on
 * PowerShell to decide whether to redirect — the trust record written the last
 * time the authority was installed is the fast answer, and the store is checked
 * in the background to correct it.
 *
 * The interlock worth stating plainly: the endpoint is only rewritten once the
 * authority is trusted. An untrusted authority means the language server would
 * refuse the TLS handshake, so redirecting it would take chat away entirely. In
 * that state the argument is left as Antigravity wrote it and chat carries on
 * through the bundled subscription.
 *
 * The certificate is nobody's decision but this file's. Arming installs the
 * authority if the store does not have it; `retire` takes it back out when no
 * enabled plugin asks for the translator any more. So switching the plugin on
 * means a restart and nothing else, and switching it off puts chat back on the
 * bundled subscription immediately.
 */

import type { GeminiConfig, GeminiCounts, GeminiKeyTest, GeminiPhase, GeminiStatus } from "../../protocol.js";
import { logger } from "../logger.js";
import { AuditLog } from "./audit.js";
import {
  certificateFiles,
  checkTrust,
  installTrust,
  loadOrMint,
  readTrustRecord,
  removeTrust,
  type CertificateFiles,
  type CertificateMaterial,
  type TrustState
} from "./certificate.js";
import { installEndpointHook } from "./endpoint.js";
import { GeminiProxy, probeKey, type ProxySettings } from "./proxy.js";
import { GOOGLE_BASE, ModelRegistry, parseBaseUrl } from "./translate.js";

const NO_COUNTS: GeminiCounts = { translated: 0, passedThrough: 0, failed: 0 };

/**
 * The one thing left for the user to do, and the same sentence whether the
 * certificate has landed yet or is still being installed — the answer is a
 * restart either way, and saying it twice in different words would mean two
 * notifications for one action.
 */
const RESTART_PROMPT = "Restart Antigravity to send its chat through your key.";

/** Windows is where the store is, so it is where this can work at all. */
const WINDOWS_ONLY = "The certificate can only be installed on Windows.";

/** What the panel controls, with the defaults that apply before it has spoken. */
interface Preferences extends ProxySettings {
  readonly audit: boolean;
}

const DEFAULTS: Preferences = {
  apiKey: "",
  base: GOOGLE_BASE,
  stream: true,
  thoughts: true,
  bypass: false,
  audit: false
};

/** Reads a plugin's declared preferences, ignoring anything malformed. */
export function readPreferences(config: GeminiConfig | undefined, previous: Preferences = DEFAULTS): Preferences {
  const source = config ?? {};
  const flag = (value: unknown, fallback: boolean): boolean => (typeof value === "boolean" ? value : fallback);
  return {
    apiKey: typeof source.apiKey === "string" ? source.apiKey.trim() : previous.apiKey,
    base: typeof source.baseUrl === "string" ? parseBaseUrl(source.baseUrl) : previous.base,
    stream: flag(source.stream, previous.stream),
    thoughts: flag(source.thoughts, previous.thoughts),
    bypass: flag(source.bypass, previous.bypass),
    audit: flag(source.audit, previous.audit)
  };
}

export class GeminiTranslator {
  private readonly files: CertificateFiles;
  private readonly registry = new ModelRegistry();
  private readonly audit = new AuditLog();
  private readonly listeners = new Set<(status: GeminiStatus) => void>();

  private preferences: Preferences = DEFAULTS;
  private material: CertificateMaterial | undefined;
  private proxy: GeminiProxy | undefined;
  private unhook: (() => void) | undefined;

  private armed = false;
  private trusted = false;
  /** Why the translator cannot serve, when something is wrong with it. */
  private problem: string | undefined;
  /**
   * Why the authority is not in the store, when it will not go there. Kept apart
   * from `problem` because the listener and the store are settled independently
   * and finish in whichever order the platform decides — one field between them
   * would let the listener's success erase the store's failure.
   */
  private trustProblem: string | undefined;
  /**
   * Whether the plugin has been switched off in this session. The listener stays
   * up and forwards untranslated, because the language server's argument cannot
   * be unwritten while it runs.
   */
  private suspended = false;
  /**
   * Whether the language server now running was pointed at us. It starts as
   * `false` because a plugin enabled mid-session finds one already talking to
   * Google, which no amount of configuring can change.
   */
  private routed = false;
  private latest: GeminiStatus = { phase: "off", keyed: false, trusted: false, restartRequired: false, counts: NO_COUNTS };

  constructor(
    private readonly directory: string,
    private readonly platform: string = process.platform
  ) {
    this.files = certificateFiles(directory);
  }

  /**
   * Puts the translator in the path. Called before Electron is ready, so the
   * synchronous half — the certificate, the trust record, the `spawn` wrapper —
   * is in place immediately and only the port is awaited.
   */
  arm(config: GeminiConfig | undefined): void {
    this.preferences = readPreferences(config);
    this.audit.open(this.directory);
    this.audit.setEnabled(this.preferences.audit);
    if (this.armed) return;
    this.armed = true;

    try {
      const material = loadOrMint(this.files);
      this.material = material;
      // The record, not the store: reading the store means PowerShell, and the
      // language server will have started before it answers.
      this.trusted = readTrustRecord(this.files)?.thumbprint === material.thumbprint;
      logger.info(`gemini: authority ${material.thumbprint}${this.trusted ? " (trusted)" : " (not yet trusted)"}`);
    } catch (error) {
      this.problem = "The certificate could not be created.";
      logger.error("gemini: the certificate could not be created.", error);
      this.publish();
      return;
    }

    this.unhook = installEndpointHook({
      endpoint: () => this.endpoint(),
      onSpawn: (endpoint) => {
        this.routed = endpoint !== undefined;
        this.publish();
      }
    });

    void this.start();
    // The store is the slow half of this, so it is settled in the background:
    // installing the authority if it is missing, and correcting an optimistic
    // record if it was removed by hand.
    void this.reconcileTrust();
  }

  /** Opens the listener, or remembers why it could not be opened. */
  private async start(): Promise<void> {
    const material = this.material;
    if (material === undefined) return;

    const proxy = new GeminiProxy({
      material,
      registry: this.registry,
      audit: this.audit,
      settings: () => this.serving(),
      onActivity: () => this.publish()
    });

    try {
      await proxy.listen();
      this.proxy = proxy;
      this.problem = undefined;
    } catch (error) {
      this.problem = "A local port could not be opened for the translator.";
      logger.error("gemini: a local port could not be opened for the translator.", error);
    }
    this.publish();
  }

  /**
   * The address to hand the language server, or undefined to leave the argument
   * as Antigravity wrote it. Trust is part of the answer because an untrusted
   * authority means a refused handshake, and a refused handshake is worse than
   * chat carrying on through the bundled subscription.
   *
   * The key is deliberately not part of the answer. The listener passes requests
   * through untouched when there is no key, so being routed costs nothing, and
   * pasting a key later then works without restarting the editor.
   */
  private endpoint(): string | undefined {
    const port = this.proxy?.port;
    if (!this.armed || port === undefined || !this.trusted) return undefined;
    return `https://127.0.0.1:${port}`;
  }

  /**
   * Puts the store in the state the feature needs, and says so if it will not go
   * there. Slow — it is PowerShell — which is why nothing waits for it: the
   * record already decided this launch's redirect, and this is what makes the
   * next one right.
   *
   * Installing without being asked is the point. The alternative was a button
   * that every user had to find and press once, to authorise something they had
   * already authorised by switching the plugin on; `retire` is what keeps that
   * honest, by taking the authority out again when nothing wants it.
   */
  private async reconcileTrust(): Promise<void> {
    const material = this.material;
    if (material === undefined) return;

    let state: TrustState;
    try {
      state = await checkTrust(material.thumbprint, this.platform);
    } catch (error) {
      logger.error("gemini: the certificate store could not be read.", error);
      return;
    }

    // Nowhere to look. If the record says it was trusted anyway, that is the only
    // answer there is and it stands; otherwise this is as far as the feature goes.
    if (state === "unsupported") {
      if (this.trusted) return;
      this.trustProblem = WINDOWS_ONLY;
      logger.info(`gemini: ${WINDOWS_ONLY}`);
      this.publish();
      return;
    }

    if (state === "untrusted") {
      const outcome = await installTrust(this.files, material.thumbprint, this.platform);
      state = outcome.state;
      logger.info(`gemini: ${outcome.message}`);
      // A store that will not take the authority is worth reporting, because
      // everything else about the feature looks perfectly healthy.
      this.trustProblem = state === "trusted" ? undefined : outcome.message;
    } else {
      this.trustProblem = undefined;
    }

    const trusted = state === "trusted";
    if (trusted !== this.trusted) {
      this.trusted = trusted;
      logger.info(
        trusted
          ? "gemini: the authority is in the store."
          : "gemini: the authority is not in the store, so chat was left with Google."
      );
    }
    this.publish();
  }

  /**
   * No enabled plugin asks for the translator, so the authority comes back out of
   * the store. Called at launch, which is the one moment removing it cannot break
   * anything: nothing has been routed through it yet.
   */
  async retire(): Promise<void> {
    if (this.armed) return;
    const record = readTrustRecord(this.files);
    // No record means nothing was ever installed, and asking Windows about a
    // certificate that does not exist costs a PowerShell for nothing.
    if (record === undefined) return;

    const outcome = await removeTrust(this.files, record.thumbprint, this.platform);
    this.trusted = outcome.state === "trusted";
    logger.info(`gemini: nothing asks for the translator, so ${lowerFirst(outcome.message)}`);
  }

  /**
   * Applies what the panel says. A plugin enabled mid-session arrives here
   * without having been armed, so this is also the second way in.
   *
   * Nothing is torn down when the key is cleared. The listener stays up and
   * forwards requests untouched, because the language server's argument cannot
   * be unwritten while it is running — closing the listener would take chat
   * away until the next launch, which is the opposite of what clearing a key
   * asks for.
   */
  configure(config: GeminiConfig | undefined): GeminiStatus {
    if (!this.armed) {
      this.arm(config);
      return this.latest;
    }
    this.suspended = false;
    this.preferences = readPreferences(config, this.preferences);
    this.audit.setEnabled(this.preferences.audit);
    if (!this.suspended && this.preferences.apiKey !== "" && !this.preferences.bypass) {
      this.proxy?.warmup(this.preferences.apiKey, this.preferences.base);
    }
    this.publish();
    return this.latest;
  }

  /**
   * The plugin was switched off. Chat goes back to the bundled subscription here
   * and now — the listener stays up and forwards requests untouched, because the
   * language server's endpoint cannot be unwritten while it is running, and
   * closing the listener would take chat away until the next launch.
   *
   * The authority stays in the store until then too, for the same reason: the
   * language server is still pointed at a certificate signed by it, and removing
   * it would fail the next handshake instead of falling back gracefully.
   */
  suspend(): GeminiStatus {
    if (!this.armed || this.suspended) return this.latest;
    this.suspended = true;
    logger.info("gemini: the plugin was switched off, so requests are being forwarded untranslated.");
    this.publish();
    return this.latest;
  }

  /**
   * The plugin is back on. Nothing to do unless it had been switched off or was
   * never armed, in which case the settings it saved are read again — a plugin
   * switched on mid-session has no script running yet to supply them.
   */
  resume(read: () => GeminiConfig): GeminiStatus {
    if (!this.armed) {
      this.arm(read());
      return this.latest;
    }
    if (!this.suspended) return this.latest;
    logger.info("gemini: the plugin was switched on again.");
    return this.configure(read());
  }

  /** What the panel draws. Synchronous, so opening the panel never waits. */
  status(): GeminiStatus {
    return this.latest;
  }

  /** Everything wrong with the translator, the listener's own trouble first. */
  private trouble(): string | undefined {
    return this.problem ?? this.trustProblem;
  }

  /**
   * The settings the listener serves by. A plugin that has been switched off is
   * the same thing to the listener as one that asked to be bypassed: forward,
   * translate nothing.
   */
  private serving(): Preferences {
    return this.suspended ? { ...this.preferences, bypass: true } : this.preferences;
  }

  /**
   * Asks whether the key works. Deliberately not through the listener: this way
   * a failure is about the key and the base URL, and cannot be a certificate
   * that is not installed or a language server that was never redirected.
   */
  test(): Promise<GeminiKeyTest> {
    return probeKey(this.preferences.apiKey, this.preferences.base);
  }

  /** Follows the status for as long as the returned function is not called. */
  onStatusChanged(listener: (status: GeminiStatus) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Shutdown: the wrapper comes off, the listener closes, the log is flushed. */
  async dispose(): Promise<void> {
    this.unhook?.();
    this.unhook = undefined;
    this.armed = false;
    this.listeners.clear();

    const proxy = this.proxy;
    this.proxy = undefined;
    if (proxy !== undefined) {
      try {
        await proxy.close();
      } catch (error) {
        logger.error("gemini: the translator did not close cleanly.", error);
      }
    }
  }

  /** Rebuilds the status and tells anyone listening, if it actually changed. */
  private publish(): void {
    const status = this.compute();
    if (unchanged(status, this.latest)) return;
    this.latest = status;
    for (const listener of this.listeners) {
      try {
        listener(status);
      } catch (error) {
        logger.error("A Gemini status listener threw.", error);
      }
    }
  }

  /**
   * The whole state of the feature in one object, derived rather than stored, so
   * that "what is it doing" is answered in exactly one place.
   */
  private compute(): GeminiStatus {
    const endpoint = this.endpoint();
    const port = this.proxy?.port;
    const thumbprint = this.material?.thumbprint;
    const keyed = this.preferences.apiKey !== "";
    const [phase, message] = this.describe(keyed, endpoint);

    return {
      phase,
      keyed,
      trusted: this.trusted,
      // Only worth saying when a restart would actually change something: the
      // listener is up, nothing is wrong with it, and the language server that is
      // running is talking to Google. Whether the certificate has landed yet is
      // not part of it — by the next launch it will have.
      restartRequired: !this.routed && !this.suspended && this.trouble() === undefined && this.proxy !== undefined,
      counts: this.proxy?.counts ?? NO_COUNTS,
      ...(port === undefined ? {} : { port }),
      ...(thumbprint === undefined ? {} : { thumbprint }),
      ...(message === undefined ? {} : { message })
    };
  }

  /** Which of the four phases this is, and the sentence the panel prints. */
  private describe(keyed: boolean, endpoint: string | undefined): [GeminiPhase, string | undefined] {
    const base = this.preferences.base;
    // A base URL that could not be read is worth saying wherever it is relevant,
    // because everything else about the feature will look perfectly healthy.
    const complaint = base.problem === undefined ? "" : ` ${base.problem}`;
    const trouble = this.trouble();

    if (!this.armed) return ["off", undefined];
    if (this.suspended) return ["off", "The plugin is switched off, so chat is going through the bundled subscription."];
    if (trouble !== undefined) return ["blocked", trouble];
    if (this.proxy === undefined) return ["blocked", "The translator is still starting up."];
    if (this.preferences.bypass) return ["off", "Requests are being forwarded untranslated, for comparison."];
    if (!keyed) return ["off", "No API key is set, so chat is going through the bundled subscription."];
    // Either the language server was started before this was ready, or the
    // certificate had not landed in time to redirect it. One restart, either way.
    if (!this.routed || endpoint === undefined) return ["listening", `${RESTART_PROMPT}${complaint}`];
    if (base.problem !== undefined) return ["routing", `Chat is going through your key.${complaint}`];
    return ["routing", `Chat is going through your key, to ${base.origin}.`];
  }
}

/** For dropping a sentence of someone else's into the middle of one of ours. */
function lowerFirst(text: string): string {
  return text.length === 0 ? text : `${text[0]?.toLowerCase() ?? ""}${text.slice(1)}`;
}

/** Whether two statuses would draw the same panel. */
function unchanged(left: GeminiStatus, right: GeminiStatus): boolean {
  return (
    left.phase === right.phase &&
    left.port === right.port &&
    left.keyed === right.keyed &&
    left.trusted === right.trusted &&
    left.thumbprint === right.thumbprint &&
    left.restartRequired === right.restartRequired &&
    left.message === right.message &&
    left.counts.translated === right.counts.translated &&
    left.counts.passedThrough === right.counts.passedThrough &&
    left.counts.failed === right.counts.failed
  );
}

