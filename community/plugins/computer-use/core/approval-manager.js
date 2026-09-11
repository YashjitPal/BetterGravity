/**
 * Security & App Approval Manager for Computer Use
 * Extracted from main process / approval bridge
 */

export class AppApprovalManager {
  constructor() {
    // Persistent always-allowed app identifiers (bundle IDs or exe names)
    this.alwaysAllowed = new Set();
    // Session-scoped allowed apps
    this.sessionAllowed = new Set();
    // Pending approval requests keyed by request ID
    this.pendingApprovals = new Map();
    // Event listeners
    this.listeners = new Set();
  }

  /**
   * Subscribe to approval events
   */
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify(event) {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  /**
   * Check if app is already allowed
   */
  isAppAllowed(appId) {
    if (!appId) return true;
    return this.alwaysAllowed.has(appId) || this.sessionAllowed.has(appId);
  }

  /**
   * Request user approval for an app
   */
  async requestApproval({ appName, appId, toolName }) {
    if (this.isAppAllowed(appId)) {
      return { status: "allowed", resolution: "accepted" };
    }

    const requestId = `computer-use-approval:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`;
    
    const promise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingApprovals.delete(requestId);
        reject(new Error("Computer Use approval request timed out"));
      }, 300000); // 5 minute timeout matching app Ci = 300 * 1e3

      this.pendingApprovals.set(requestId, {
        resolve,
        reject,
        timeout,
        appId,
        appName,
        toolName,
      });
    });

    this.notify({
      type: "approval-requested",
      requestId,
      appId,
      appName,
      toolName,
    });

    return promise;
  }

  /**
   * Resolve a pending approval (called from UI modal)
   */
  resolveApproval(requestId, { action, persist = "session" }) {
    const pending = this.pendingApprovals.get(requestId);
    if (!pending) return false;

    clearTimeout(pending.timeout);
    this.pendingApprovals.delete(requestId);

    if (action === "accept") {
      if (persist === "always" && pending.appId) {
        this.alwaysAllowed.add(pending.appId);
      } else if (pending.appId) {
        this.sessionAllowed.add(pending.appId);
      }
      pending.resolve({ status: "allowed", resolution: "accepted", persist });
    } else {
      pending.resolve({ status: "denied", resolution: action === "cancel" ? "canceled" : "declined" });
    }

    this.notify({
      type: "approval-resolved",
      requestId,
      action,
      appId: pending.appId,
    });

    return true;
  }

  /**
   * Remove app from always-allowed list
   */
  removeAlwaysAllowed(appId) {
    const removed = this.alwaysAllowed.delete(appId);
    if (removed) {
      this.notify({ type: "allowed-apps-updated", alwaysAllowed: Array.from(this.alwaysAllowed) });
    }
    return removed;
  }

  /**
   * List all currently allowed apps
   */
  getAllowedApps() {
    return {
      always: Array.from(this.alwaysAllowed),
      session: Array.from(this.sessionAllowed),
    };
  }

  /**
   * Clear session-scoped permissions
   */
  clearSession() {
    this.sessionAllowed.clear();
    for (const [id, pending] of this.pendingApprovals) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("Session ended"));
    }
    this.pendingApprovals.clear();
  }
}
