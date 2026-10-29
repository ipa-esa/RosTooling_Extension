import * as cp from 'node:child_process';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { HeadlessLspClient, Diagnostic } from './HeadlessLspClient.js';
import {
  processAndWriteFiles,
  scanExistingFiles,
  cleanOppositeLanguageFiles,
} from './PostProcessor.js';
import { RosModelParser } from '../model/RosModelParser.js';

class LspSessionManager {
  private activeClient: HeadlessLspClient | null = null;
  private currentWorkspaceDir: string | null = null;

  public async getClient(workspaceDir: string): Promise<HeadlessLspClient> {
    const resolved = path.resolve(workspaceDir);
    if (this.activeClient && this.currentWorkspaceDir === resolved) {
      return this.activeClient;
    }

    if (this.activeClient) {
      await this.activeClient.stop();
      this.activeClient = null;
      this.currentWorkspaceDir = null;
    }

    const client = new HeadlessLspClient();
    await client.start(resolved);
    this.activeClient = client;
    this.currentWorkspaceDir = resolved;
    return client;
  }

  public async closeAll(): Promise<void> {
    if (this.activeClient) {
      await this.activeClient.stop();
      this.activeClient = null;
      this.currentWorkspaceDir = null;
    }
  }
}

const sessionManager = new LspSessionManager();

// Graceful cleanup on process exit
process.on('SIGINT', async () => {
  await sessionManager.closeAll();
  process.exit(0);
});
process.on('SIGTERM', async () => {
  await sessionManager.closeAll();
  process.exit(0);
});

/**
 * Finds the sensible workspace root for a given model path.
 */
function resolveWorkspaceDir(modelPath: string, explicitWorkspaceDir?: string): string {
  if (explicitWorkspaceDir && fs.existsSync(explicitWorkspaceDir)) {
    return path.resolve(explicitWorkspaceDir);
  }

  let current = path.dirname(path.resolve(modelPath));
  while (current !== path.dirname(current)) {
    if (
      fs.existsSync(path.join(current, 'src-gen')) ||
      fs.existsSync(path.join(current, 'package.xml')) ||
      fs.existsSync(path.join(current, '.git')) ||
      fs.existsSync(path.join(current, 'CMakeLists.txt'))
    ) {
      return current;
    }
    current = path.dirname(current);
  }

  return path.dirname(path.resolve(modelPath));
}

/**
 * Opens all companion .ros and .ros2 files in the model's directory.
 */
async function openCompanionFiles(client: HeadlessLspClient, modelDir: string): Promise<void> {
  try {
    const entries = await fsp.readdir(modelDir, { withFileTypes: true });
    // Load .ros files first (message definitions), then .ros2
    const rosFiles = entries.filter(e => e.isFile() && e.name.endsWith('.ros'));
    const ros2Files = entries.filter(e => e.isFile() && e.name.endsWith('.ros2'));

    for (const entry of rosFiles) {
      await client.openDocument(path.join(modelDir, entry.name), 'ros');
    }
    for (const entry of ros2Files) {
      await client.openDocument(path.join(modelDir, entry.name), 'ros2');
    }
  } catch {
    // Ignore read errors
  }
}

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'rostooling-mcp-server',
    version: '2.2.1',
  });

  // Tool 1: generate_ros2_wrappers
  server.tool(
    'generate_ros2_wrappers',
    'Generates C++, Python, or Hybrid ROS 2 node wrappers, runners, CMakeLists.txt, and starter domain logic templates from a .ros2 model file into src-gen/.',
    {
      model_path: z.string().describe('Absolute or relative path to the .ros2 model file.'),
      target_nodes: z
        .array(z.string())
        .optional()
        .describe('Specific node/artifact names to generate. Omit or pass [] to generate all nodes in the package.'),
      language: z
        .enum(['cpp', 'python', 'both'])
        .optional()
        .default('cpp')
        .describe("Implementation language: 'cpp', 'python', or 'both' (hybrid). Defaults to 'cpp'."),
      ros_distro: z
        .enum(['humble', 'jazzy', 'iron', 'rolling'])
        .optional()
        .default('humble')
        .describe("Target ROS 2 distribution (e.g. 'humble', 'jazzy'). Defaults to 'humble'."),
      workspace_dir: z
        .string()
        .optional()
        .describe("Workspace root directory containing src-gen/ or src/. Defaults to the package directory."),
    },
    async ({ model_path, target_nodes, language, ros_distro, workspace_dir }) => {
      const absModelPath = path.resolve(model_path);
      if (!fs.existsSync(absModelPath)) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ error: `Model file not found at: ${absModelPath}` }),
            },
          ],
        };
      }

      if (!absModelPath.endsWith('.ros2')) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ error: `File is not a ROS 2 (.ros2) model file: ${absModelPath}` }),
            },
          ],
        };
      }

      const rootDir = resolveWorkspaceDir(absModelPath, workspace_dir);
      const srcGenDir = path.join(rootDir, 'src-gen');
      await fsp.mkdir(srcGenDir, { recursive: true });

      // Parse model to discover package name and nodes
      const docText = await fsp.readFile(absModelPath, 'utf-8');
      const parsed = RosModelParser.parseRos2(docText, absModelPath);
      const pkgName = parsed.system?.name || path.basename(absModelPath, '.ros2');
      const allNodesInFile = (parsed.nodes || []).map(n => ({
        artifactName: n.artifact || n.label,
        nodeName: n.label,
      }));

      const nodesToProcess =
        target_nodes && target_nodes.length > 0
          ? allNodesInFile.filter(
              n => target_nodes.includes(n.artifactName) || target_nodes.includes(n.nodeName)
            )
          : allNodesInFile;

      // Clean opposite-language files if re-generating with a different language
      if (language === 'cpp' || language === 'python') {
        for (const n of nodesToProcess) {
          await cleanOppositeLanguageFiles(srcGenDir, pkgName, n, language);
        }
      }

      // Scan existing files in package
      const pkgDir = path.join(srcGenDir, pkgName);
      const existingFiles = await scanExistingFiles(pkgDir, pkgName);

      const client = await sessionManager.getClient(rootDir);
      await openCompanionFiles(client, path.dirname(absModelPath));
      await client.openDocument(absModelPath, 'ros2', docText);

      const modelUri = pathToFileURL(absModelPath).href;
      const targetNodeNames = nodesToProcess.map(n => n.artifactName);

      let genResult: { files?: Record<string, string>; error?: string } = {};

      if (language === 'both') {
        // Hybrid: C++ for first half, Python for remaining or custom per node
        genResult = await client.executeCommand('ros2.generateWrappersServer', [
          modelUri,
          targetNodeNames,
          'both',
          ros_distro,
          existingFiles,
        ]);
      } else {
        genResult = await client.executeCommand('ros2.generateWrappersServer', [
          modelUri,
          targetNodeNames,
          language,
          ros_distro,
          existingFiles,
        ]);
      }

      if (genResult.error) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ error: genResult.error }),
            },
          ],
        };
      }

      const files = genResult.files || {};
      const postRes = await processAndWriteFiles(srcGenDir, files, false);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                status: 'success',
                package: pkgName,
                workspaceDir: rootDir,
                outputDir: path.join(srcGenDir, pkgName),
                totalGenerated: Object.keys(files).length,
                writtenCount: postRes.writtenFiles.length,
                skippedCount: postRes.skippedFiles.length,
                writtenFiles: postRes.writtenFiles,
                skippedFiles: postRes.skippedFiles,
                cleanedFiles: postRes.cleanedFiles,
                errors: postRes.errors,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  // Tool 2: generate_rossystem_code
  server.tool(
    'generate_rossystem_code',
    'Generates ROS 2 launch files (<system>.launch.py), ComposableNodeContainer configurations, parameter YAMLs, and PlantUML diagrams from a .rossystem composition into src-gen/.',
    {
      model_path: z.string().describe('Absolute or relative path to the .rossystem model file.'),
      workspace_dir: z
        .string()
        .optional()
        .describe("Workspace root directory containing src-gen/ or src/. Defaults to model directory or parent."),
    },
    async ({ model_path, workspace_dir }) => {
      const absModelPath = path.resolve(model_path);
      if (!fs.existsSync(absModelPath)) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ error: `Model file not found at: ${absModelPath}` }),
            },
          ],
        };
      }

      if (!absModelPath.endsWith('.rossystem')) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ error: `File is not a ROS System (.rossystem) model file: ${absModelPath}` }),
            },
          ],
        };
      }

      const rootDir = resolveWorkspaceDir(absModelPath, workspace_dir);
      const srcGenDir = path.join(rootDir, 'src-gen');
      await fsp.mkdir(srcGenDir, { recursive: true });

      const existingFiles = await scanExistingFiles(srcGenDir);

      const client = await sessionManager.getClient(rootDir);
      await openCompanionFiles(client, path.dirname(absModelPath));
      await client.openDocument(absModelPath, 'rossystem');

      const modelUri = pathToFileURL(absModelPath).href;
      const genResult = await client.executeCommand<{ files?: Record<string, string>; error?: string }>(
        'rossystem.generateCode',
        [modelUri, existingFiles]
      );

      if (genResult.error) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ error: genResult.error }),
            },
          ],
        };
      }

      const files = genResult.files || {};
      const postRes = await processAndWriteFiles(srcGenDir, files, true);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                status: 'success',
                workspaceDir: rootDir,
                outputDir: srcGenDir,
                totalGenerated: Object.keys(files).length,
                writtenCount: postRes.writtenFiles.length,
                skippedCount: postRes.skippedFiles.length,
                writtenFiles: postRes.writtenFiles,
                skippedFiles: postRes.skippedFiles,
                cleanedFiles: postRes.cleanedFiles,
                errors: postRes.errors,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  // Tool 3: validate_ros_model
  server.tool(
    'validate_ros_model',
    'Validates syntax, types, connections, and constraints of a .ros, .ros2, or .rossystem model file using the official RosTooling Language Server.',
    {
      model_path: z.string().describe('Absolute or relative path to the model file to validate.'),
      workspace_dir: z
        .string()
        .optional()
        .describe('Workspace root directory. Defaults to the directory containing the model file.'),
    },
    async ({ model_path, workspace_dir }) => {
      const absModelPath = path.resolve(model_path);
      if (!fs.existsSync(absModelPath)) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ error: `Model file not found at: ${absModelPath}` }),
            },
          ],
        };
      }

      const rootDir = resolveWorkspaceDir(absModelPath, workspace_dir);
      const client = await sessionManager.getClient(rootDir);

      // Open companion files first
      await openCompanionFiles(client, path.dirname(absModelPath));

      const diagPromise = client.collectDiagnostics(absModelPath, 3000);
      await client.openDocument(absModelPath);
      const diags: Diagnostic[] = await diagPromise;

      const errors = diags.filter(d => d.severity === 'ERROR');
      const warnings = diags.filter(d => d.severity === 'WARNING');

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                file: path.basename(absModelPath),
                isValid: errors.length === 0,
                errorCount: errors.length,
                warningCount: warnings.length,
                diagnostics: diags,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  // Tool 4: build_ros2_package
  server.tool(
    'build_ros2_package',
    'Builds generated packages using colcon build in the target ROS 2 workspace.',
    {
      workspace_dir: z.string().describe('ROS 2 workspace root directory containing src/ or src-gen/.'),
      package_name: z.string().optional().describe('Specific package name to build with --packages-select.'),
      symlink_install: z
        .boolean()
        .optional()
        .default(true)
        .describe('Whether to pass --symlink-install to colcon build. Defaults to true.'),
    },
    async ({ workspace_dir, package_name, symlink_install }) => {
      const rootDir = path.resolve(workspace_dir);
      if (!fs.existsSync(rootDir)) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ error: `Workspace directory not found: ${rootDir}` }),
            },
          ],
        };
      }

      const cmdArgs = ['build'];
      if (symlink_install) {
        cmdArgs.push('--symlink-install');
      }
      if (package_name) {
        cmdArgs.push('--packages-select', package_name);
      }

      return new Promise((resolve) => {
        const proc = cp.spawn('colcon', cmdArgs, {
          cwd: rootDir,
          shell: true,
        });

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', d => {
          stdout += d.toString();
        });
        proc.stderr.on('data', d => {
          stderr += d.toString();
        });

        proc.on('close', code => {
          resolve({
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    command: `colcon ${cmdArgs.join(' ')}`,
                    exitCode: code,
                    success: code === 0,
                    stdout: stdout.trim(),
                    stderr: stderr.trim(),
                  },
                  null,
                  2
                ),
              },
            ],
          });
        });

        proc.on('error', err => {
          resolve({
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  error: `Failed to execute colcon: ${err.message}. Make sure colcon is installed and in PATH.`,
                }),
              },
            ],
          });
        });
      });
    }
  );

  return server;
}

export async function runServer(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[RosTooling MCP Server] Connected via stdio transport');
}

if (require.main === module) {
  runServer().catch(err => {
    console.error('[RosTooling MCP Server Fatal Error]:', err);
    process.exit(1);
  });
}
