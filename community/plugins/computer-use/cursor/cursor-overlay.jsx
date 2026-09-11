/**
 * Agent Cursor React Overlay Component
 * Extracted and reconstructed from module 2673 (conversationId.67.js)
 */

import React, { useRef, useEffect } from "react";
import { AgentCursor } from "./cursor-physics.js";
import { CURSOR_CONFIG } from "./cursor-asset.js";

export function AgentCursorOverlay({
  conversationId = "default",
  cursor = null,
  isVisible = true,
  viewportSize = { width: 1920, height: 1080 },
  glowColor = "var(--color-accent-blue, #007aff)",
  onCursorArrived = null,
  dataTestId = "browser-agent-cursor-overlay",
}) {
  const containerRef = useRef(null);
  const cursorInstanceRef = useRef(null);

  // Initialize and mount AgentCursor instance
  useEffect(() => {
    if (!containerRef.current) return;

    const instance = new AgentCursor(containerRef.current, {
      glowColor,
      onArrived: (moveSequence) => {
        onCursorArrived?.({ conversationId, moveSequence });
      },
    });

    cursorInstanceRef.current = instance;

    return () => {
      instance.destroy();
      cursorInstanceRef.current = null;
    };
  }, [conversationId, glowColor, onCursorArrived]);

  // Update cursor position and motion
  useEffect(() => {
    cursorInstanceRef.current?.setState({
      cursor,
      isVisible,
      turnKey: `${conversationId}:${isVisible ? "active" : "inactive"}`,
      viewportSize,
    });
  }, [conversationId, cursor, isVisible, viewportSize]);

  return (
    <div
      ref={containerRef}
      className="pointer-events-none absolute inset-0 z-20 overflow-hidden"
      data-testid={dataTestId}
    />
  );
}
