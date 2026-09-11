/**
 * Type definitions for Codex Computer Use Plugin & Native Pipe Server
 */

export interface JsonRpcRequest<T = any> {
  jsonrpc: "2.0";
  id?: string | number;
  method: string;
  params?: T;
}

export interface JsonRpcResponse<T = any> {
  jsonrpc: "2.0";
  id: string | number;
  result?: T;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

export interface CodexTurnMetadata {
  thread_id?: string;
  threadId?: string;
  turn_id?: string;
  item_id?: string;
  itemId?: string;
  call_id?: string;
  model?: string;
  reasoning_effort?: string;
  thread_source?: string;
}

export interface ComputerUseToolParams {
  codexTurnMetadata?: CodexTurnMetadata;
  method: string;
  params?: Record<string, any>;
}

export interface AppApprovalRequest {
  toolName: string;
  bundleIdentifier?: string;
  displayName?: string;
  appPath?: string;
  persist?: "always" | "session";
}

export type AppApprovalResolution = "accepted" | "declined" | "canceled";

export interface NativeAppInfo {
  id: string;
  displayName: string;
  bundleId?: string;
  appPath?: string;
  iconSmall?: string;
  windows?: Array<{
    id: number | string;
    title?: string;
    frame?: { x: number; y: number; width: number; height: number };
  }>;
}

export interface CursorState {
  x: number;
  y: number;
  visible?: boolean;
  animateMovement?: boolean;
  moveSequence?: number;
}
