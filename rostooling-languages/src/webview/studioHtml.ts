import * as path from 'path';
import * as vscode from 'vscode';
import { RosProject } from '../model/RosModelTypes';

function resolveAssetUri(extensionUri: vscode.Uri, webview: vscode.Webview, segments: string[]): string {
  const canJoin = Boolean(extensionUri && typeof (extensionUri as { with?: unknown }).with === 'function');
  const fileUri = canJoin
    ? vscode.Uri.joinPath(extensionUri, ...segments)
    : vscode.Uri.file(path.join(extensionUri?.fsPath || '', ...segments));
  const resolved = typeof webview?.asWebviewUri === 'function' ? webview.asWebviewUri(fileUri) : fileUri;
  return String(resolved);
}

export function getStudioHtml(
  project: RosProject,
  extensionUri: vscode.Uri,
  webview: vscode.Webview,
  nodeIndex: unknown,
  typeIndex: unknown,
  docFileName?: string,
  isReadOnly?: boolean
): string {
  const nonce = getNonce();
  const mode = project.isRos ? 'ros' : project.isRosSystem !== false ? 'system' : 'component';
  const scriptUri = resolveAssetUri(extensionUri, webview, ['src', 'webview', 'frontend', 'dist', 'studio.js']);
  const styleUri = resolveAssetUri(extensionUri, webview, ['src', 'webview', 'frontend', 'dist', 'studio.css']);
  const cspSource = webview?.cspSource || 'vscode-webview-resource:';
  const initialData = JSON.stringify({
    project,
    mode,
    isReadOnly: Boolean(isReadOnly),
    docFileName: docFileName || '',
    nodeIndex: nodeIndex || {},
    typeIndex: typeIndex || {},
  }).replace(/</g, '\\u003c');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${cspSource}; font-src ${cspSource} data:; img-src ${cspSource} data:;">
  <title>RosTooling Visual Studio</title>
  <link rel="stylesheet" href="${styleUri}">
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}">window.INITIAL_DATA = ${initialData};</script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

function getNonce(): string {
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
