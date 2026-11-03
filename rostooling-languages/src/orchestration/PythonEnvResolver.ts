import * as fs from 'fs';
import * as path from 'path';
import * as cp from 'child_process';
import * as vscode from 'vscode';

export interface ResolvedPythonInfo {
  pythonBin: string;
  version: string;
  major: number;
  minor: number;
  source: 'setting' | 'ms-python' | 'workspace-venv' | 'system';
}

export interface ResolvedStudioBackend {
  python: ResolvedPythonInfo;
  serverScriptPath: string;
  rosStudioScriptPath: string;
  studioRoot: string;
}

interface MsPythonExtensionApi {
  environments?: {
    getActiveEnvironmentPath?: (resource?: vscode.Uri) => { path?: string } | undefined;
  };
  settings?: {
    getExecutionDetails?: (resource?: vscode.Uri) => { execCommand?: string[] } | undefined;
  };
}

export class PythonEnvResolver {
  private dismissedMissingPrompt = false;

  constructor(private readonly extensionPath: string) {}

  public async resolvePythonEnvironment(): Promise<ResolvedPythonInfo | null> {
    const candidates: { bin: string; source: ResolvedPythonInfo['source'] }[] = [];

    const cfg = vscode.workspace.getConfiguration('rostooling-languages');
    const configuredPython =
      cfg.get<string>('studio.pythonPath')?.trim() ||
      process.env.ROSTOOLING_STUDIO_PYTHON?.trim();
    if (configuredPython) {
      candidates.push({ bin: configuredPython, source: 'setting' });
    }

    const msPyBin = await this.getMsPythonInterpreter();
    if (msPyBin) {
      candidates.push({ bin: msPyBin, source: 'ms-python' });
    }

    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const wsPath = folder.uri.fsPath;
      const venvPaths =
        process.platform === 'win32'
          ? [
              path.join(wsPath, '.venv', 'Scripts', 'python.exe'),
              path.join(wsPath, 'venv', 'Scripts', 'python.exe'),
            ]
          : [
              path.join(wsPath, '.venv', 'bin', 'python'),
              path.join(wsPath, 'venv', 'bin', 'python'),
            ];
      for (const vp of venvPaths) {
        if (fs.existsSync(vp)) {
          candidates.push({ bin: vp, source: 'workspace-venv' });
        }
      }
    }

    if (process.platform === 'win32') {
      candidates.push({ bin: 'python', source: 'system' });
    } else {
      candidates.push({ bin: 'python3', source: 'system' });
      candidates.push({ bin: 'python', source: 'system' });
    }

    const seen = new Set<string>();
    for (const cand of candidates) {
      if (!cand.bin || seen.has(cand.bin)) {
        continue;
      }
      seen.add(cand.bin);
      const probed = await this.probePython(cand.bin, cand.source);
      if (probed && (probed.major > 3 || (probed.major === 3 && probed.minor >= 9))) {
        return probed;
      }
    }
    return null;
  }

  public async resolveStudioBackend(): Promise<ResolvedStudioBackend | null> {
    const python = await this.resolvePythonEnvironment();
    if (!python) {
      return null;
    }

    const scriptCandidates: string[] = [];
    const cfg = vscode.workspace.getConfiguration('rostooling-languages');
    const configuredScript = cfg.get<string>('studio.serverScriptPath')?.trim();
    if (configuredScript) {
      scriptCandidates.push(configuredScript);
    }

    const envStudioRoot = process.env.ROSTOOLING_STUDIO_ROOT?.trim();
    if (envStudioRoot) {
      scriptCandidates.push(path.join(envStudioRoot, 'scripts', 'studio_server.py'));
      scriptCandidates.push(path.join(envStudioRoot, 'studio_server.py'));
    }

    // Bundled directly inside extension package (e.g. out-of-the-box VSIX install)
    scriptCandidates.push(path.join(this.extensionPath, 'scripts', 'studio_server.py'));
    scriptCandidates.push(path.join(this.extensionPath, 'studio', 'scripts', 'studio_server.py'));
    scriptCandidates.push(path.join(this.extensionPath, 'backend', 'scripts', 'studio_server.py'));

    const modulePath = await this.probeInstalledStudioModule(python.pythonBin);
    if (modulePath) {
      scriptCandidates.push(modulePath);
    }

    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const ws = folder.uri.fsPath;
      scriptCandidates.push(path.join(ws, 'scripts', 'studio_server.py'));
      scriptCandidates.push(path.join(ws, 'ipa-rostooling-studio', 'scripts', 'studio_server.py'));
      scriptCandidates.push(
        path.join(path.dirname(ws), 'ipa-rostooling-studio', 'scripts', 'studio_server.py')
      );
    }

    // Sibling repo relative to `RosTooling_Extension/rostooling-languages`
    const extRepoRoot = path.dirname(this.extensionPath);
    scriptCandidates.push(
      path.join(path.dirname(extRepoRoot), 'ipa-rostooling-studio', 'scripts', 'studio_server.py')
    );

    for (const candidate of scriptCandidates) {
      if (!candidate) {
        continue;
      }
      const resolved = path.resolve(candidate);
      const serverScript =
        fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()
          ? path.join(resolved, 'scripts', 'studio_server.py')
          : resolved;
      if (fs.existsSync(serverScript) && fs.statSync(serverScript).isFile()) {
        const scriptsDir = path.dirname(serverScript);
        const studioRoot =
          path.basename(scriptsDir) === 'scripts' ? path.dirname(scriptsDir) : scriptsDir;
        const rosStudioScript = path.join(scriptsDir, 'ros_studio.py');
        return {
          python,
          serverScriptPath: serverScript,
          rosStudioScriptPath: rosStudioScript,
          studioRoot,
        };
      }
    }

    return null;
  }

  public async promptMissingBackend(pythonBin?: string): Promise<void> {
    if (this.dismissedMissingPrompt) {
      return;
    }
    const selection = await vscode.window.showWarningMessage(
      'RosTooling Studio backend not found (requires Python >= 3.9 and rostooling-studio).',
      'Install via pip',
      'Configure Path',
      'Ignore'
    );

    if (selection === 'Install via pip') {
      const py = pythonBin || (process.platform === 'win32' ? 'python' : 'python3');
      const term = vscode.window.createTerminal('RosTooling Studio Setup');
      term.show(true);
      term.sendText(`${py} -m pip install rostooling-studio`);
    } else if (selection === 'Configure Path') {
      const picked = await vscode.window.showOpenDialog({
        title: 'Select RosTooling Studio folder or scripts/studio_server.py',
        canSelectFiles: true,
        canSelectFolders: true,
        canSelectMany: false,
      });
      const chosen = picked?.[0]?.fsPath;
      if (chosen) {
        const scriptPath = fs.statSync(chosen).isDirectory()
          ? path.join(chosen, 'scripts', 'studio_server.py')
          : chosen;
        await vscode.workspace
          .getConfiguration('rostooling-languages')
          .update('studio.serverScriptPath', scriptPath, vscode.ConfigurationTarget.Global);
      }
    } else if (selection === 'Ignore') {
      this.dismissedMissingPrompt = true;
    }
  }

  private async getMsPythonInterpreter(): Promise<string | null> {
    try {
      const pyExt = vscode.extensions.getExtension<MsPythonExtensionApi>('ms-python.python');
      if (!pyExt) {
        return null;
      }
      const api = pyExt.isActive ? pyExt.exports : await pyExt.activate();
      const resource = vscode.workspace.workspaceFolders?.[0]?.uri;
      const envPath = api?.environments?.getActiveEnvironmentPath?.(resource)?.path;
      if (envPath) {
        return envPath;
      }
      const execCmd = api?.settings?.getExecutionDetails?.(resource)?.execCommand?.[0];
      return execCmd ?? null;
    } catch {
      return null;
    }
  }

  private probePython(
    pythonBin: string,
    source: ResolvedPythonInfo['source']
  ): Promise<ResolvedPythonInfo | null> {
    return new Promise((resolve) => {
      const child = cp.spawn(
        pythonBin,
        ['-c', 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")'],
        { stdio: ['ignore', 'pipe', 'ignore'] }
      );
      let stdout = '';
      const timer = setTimeout(() => {
        child.kill();
        resolve(null);
      }, 4000);
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.on('error', () => {
        clearTimeout(timer);
        resolve(null);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          resolve(null);
          return;
        }
        const trimmed = stdout.trim();
        const [majStr, minStr] = trimmed.split('.');
        const major = Number.parseInt(majStr ?? '', 10);
        const minor = Number.parseInt(minStr ?? '', 10);
        if (Number.isNaN(major) || Number.isNaN(minor)) {
          resolve(null);
          return;
        }
        resolve({
          pythonBin,
          version: trimmed,
          major,
          minor,
          source,
        });
      });
    });
  }

  private probeInstalledStudioModule(pythonBin: string): Promise<string | null> {
    return new Promise((resolve) => {
      const child = cp.spawn(
        pythonBin,
        ['-c', 'import studio_server; print(studio_server.__file__)'],
        { stdio: ['ignore', 'pipe', 'ignore'] }
      );
      let stdout = '';
      const timer = setTimeout(() => {
        child.kill();
        resolve(null);
      }, 3000);
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.on('error', () => {
        clearTimeout(timer);
        resolve(null);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        const found = stdout.trim();
        resolve(code === 0 && found ? found : null);
      });
    });
  }
}
