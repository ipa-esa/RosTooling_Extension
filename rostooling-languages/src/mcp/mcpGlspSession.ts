import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

import { GGraph, GModelElement, GlspAction, GlspClientBridge, GlspMarker } from '../glsp/GlspClientBridge.js';

export type Bridge = GlspClientBridge;

export interface ToolOutcome {
  success: boolean;
  file: string;
  created?: boolean;
  changed?: boolean;
  error?: string;
  errors: string[];
  warnings: string[];
  [key: string]: unknown;
}

export interface ModelSession {
  clientId: string;
  file: string;
  diskText: string;
  existed: boolean;
  graph: GGraph;
}

let sessionCounter = 0;

export function walkGModel(
  el: GModelElement | undefined,
  pred: (e: GModelElement) => boolean,
  acc: GModelElement[] = []
): GModelElement[] {
  for (const c of el?.children || []) {
    if (pred(c)) acc.push(c);
    walkGModel(c, pred, acc);
  }
  return acc;
}

export function summarizeMarkers(markers: GlspMarker[]): { errors: string[]; warnings: string[] } {
  const fmt = (m: GlspMarker) => `${m.elementId ? `[${m.elementId}] ` : ''}${m.description || m.label}`;
  return {
    errors: markers.filter((m) => m.kind === 'error').map(fmt),
    warnings: markers.filter((m) => m.kind === 'warning').map(fmt),
  };
}

export function resolveModelPath(modelPath: string, allowedExtensions: string[]): string {
  const abs = path.resolve(modelPath);
  if (!allowedExtensions.some((ext) => abs.endsWith(ext))) {
    throw new Error(`Expected ${allowedExtensions.join(' / ')} file, got: ${abs}`);
  }
  return abs;
}

export async function openModelSession(
  bridge: Bridge,
  modelPath: string,
  allowedExtensions: string[],
  mustExist: boolean,
  clientPrefix: string
): Promise<ModelSession> {
  const file = resolveModelPath(modelPath, allowedExtensions);
  const existed = fs.existsSync(file);
  if (mustExist && !existed) {
    throw new Error(`Model file not found: ${file}`);
  }
  if (!existed) {
    await fsp.mkdir(path.dirname(file), { recursive: true });
  }
  const diskText = existed ? await fsp.readFile(file, 'utf-8') : '';
  const clientId = `${clientPrefix}_${process.pid}_${++sessionCounter}`;
  const { graph } = await bridge.openSession(clientId, file);
  return { clientId, file, diskText, existed, graph };
}

/**
 * Commits the server's pending AST mutations: the server returns the surgical edits and the
 * resulting text, which is written (headless use) and re-parsed for verification + markers.
 */
export async function commitModel(
  bridge: Bridge,
  s: ModelSession
): Promise<{ changed: boolean; graph: GGraph; markers: GlspMarker[] }> {
  const res = await bridge.requestTextEdits(s.clientId);
  if (res.baseText !== s.diskText) {
    throw new Error(`${path.basename(s.file)} changed on disk while it was being edited; retry the call.`);
  }
  const changed = res.newText !== res.baseText;
  if (changed) {
    await fsp.writeFile(s.file, res.newText, 'utf-8');
    s.diskText = res.newText;
  }
  const graph = await bridge.reloadModel(s.clientId, s.file, s.diskText);
  const markers = await bridge.requestMarkers(s.clientId);
  s.graph = graph;
  return { changed, graph, markers };
}

export async function runOperation(bridge: Bridge, s: ModelSession, action: GlspAction): Promise<void> {
  await bridge.dispatchAction(s.clientId, { ...action, isOperation: true });
}

export async function withModel(
  bridge: Bridge,
  modelPath: string,
  allowedExtensions: string[],
  mustExist: boolean,
  clientPrefix: string,
  body: (s: ModelSession) => Promise<ToolOutcome>
): Promise<ToolOutcome> {
  let s: ModelSession | undefined;
  try {
    s = await openModelSession(bridge, modelPath, allowedExtensions, mustExist, clientPrefix);
    return await body(s);
  } catch (err) {
    return {
      success: false,
      file: s?.file || path.resolve(modelPath),
      error: err instanceof Error ? err.message : String(err),
      errors: [],
      warnings: [],
    };
  } finally {
    if (s) await bridge.disposeSession(s.clientId);
  }
}

export function failOutcome(s: ModelSession, error: string, extra: Record<string, unknown> = {}): ToolOutcome {
  return { success: false, file: s.file, error, errors: [], warnings: [], ...extra };
}

export function asMcpResult(outcome: ToolOutcome) {
  return {
    ...(outcome.success ? {} : { isError: true }),
    content: [{ type: 'text' as const, text: JSON.stringify(outcome, null, 2) }],
  };
}
