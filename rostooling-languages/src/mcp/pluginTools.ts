import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z, type ZodTypeAny } from 'zod';

import { GlspClientBridge } from '../glsp/GlspClientBridge.js';
import { HeadlessLspClient } from './HeadlessLspClient.js';
import {
  cleanOppositeLanguageFiles,
  processAndWriteFiles,
  scanExistingFiles,
} from './PostProcessor.js';

export interface PluginLspDeps {
  getClient: (workspaceDir: string) => Promise<HeadlessLspClient>;
  workspaceDir: () => string | null;
  resolveWorkspaceDir: (modelPath: string, explicitWorkspaceDir?: string) => string;
  openCompanionFiles: (client: HeadlessLspClient, modelDir: string) => Promise<void>;
}

interface ListedPluginBlock {
  name: string;
  setToolName?: string;
  allowedLocations?: string[];
  description?: string;
  schema?: Record<string, unknown>;
}

interface ListedPlugin {
  id: string;
  version: string;
  coreVersionRange?: string;
  dependencies?: string[];
  documentationMarkdown?: string;
  blocks?: ListedPluginBlock[];
}

interface ListedTool {
  pluginId: string;
  name: string;
  prefixedName: string;
  description: string;
  inputSchema?: Record<string, unknown>;
}

interface ListPluginsResponse {
  plugins?: ListedPlugin[];
  tools?: ListedTool[];
  loadErrors?: string[];
}

function jsonSchemaPropToZod(prop: Record<string, unknown>): ZodTypeAny {
  const type = String(prop.type || 'string');
  const desc = typeof prop.description === 'string' ? prop.description : undefined;
  let schema: ZodTypeAny;
  if (type === 'boolean') {
    schema = z.boolean();
  } else if (type === 'integer' || type === 'number') {
    schema = z.number();
  } else if (type === 'array') {
    const itemsSchema =
      prop.items && typeof prop.items === 'object'
        ? jsonSchemaPropToZod(prop.items as Record<string, unknown>)
        : z.unknown();
    const arrSchema = z.array(itemsSchema);
    schema =
      desc && desc.includes("keyed by 'name'")
        ? z.union([arrSchema, z.record(z.string(), z.record(z.string(), z.unknown()))])
        : arrSchema;
  } else if (type === 'object') {
    const nestedProps = prop.properties as Record<string, Record<string, unknown>> | undefined;
    if (nestedProps && typeof nestedProps === 'object' && Object.keys(nestedProps).length > 0) {
      const nestedReq = new Set<string>(Array.isArray(prop.required) ? prop.required.map(String) : []);
      const nestedShape: Record<string, ZodTypeAny> = {};
      for (const [nk, np] of Object.entries(nestedProps)) {
        const nf = jsonSchemaPropToZod(np || {});
        nestedShape[nk] = nestedReq.has(nk) ? nf : nf.optional();
      }
      schema = z.object(nestedShape).passthrough();
    } else {
      schema = z.record(z.string(), z.unknown());
    }
  } else if (Array.isArray(prop.enum) && prop.enum.length > 0 && prop.enum.every((v) => typeof v === 'string')) {
    const vals = prop.enum as [string, ...string[]];
    schema = z.enum(vals);
  } else {
    schema = z.string();
  }
  return desc ? schema.describe(desc) : schema;
}

const SET_BLOCK_META_KEYS = new Set([
  'model_path',
  'target_kind',
  'target_name',
  'artifact_name',
  'remove',
  'workspace_dir',
]);

export function jsonSchemaToZodShape(inputSchema?: Record<string, unknown>): Record<string, ZodTypeAny> {
  const shape: Record<string, ZodTypeAny> = {
    model_path: z.string().optional().describe('Optional path to the target model file (.ros2 or .rossystem).'),
    workspace_dir: z.string().optional().describe('Optional ROS 2 workspace root directory.'),
  };
  if (!inputSchema || typeof inputSchema !== 'object') {
    return shape;
  }
  const props = inputSchema.properties as Record<string, Record<string, unknown>> | undefined;
  const required = new Set<string>(Array.isArray(inputSchema.required) ? inputSchema.required.map(String) : []);
  if (props && typeof props === 'object') {
    for (const [k, propSchema] of Object.entries(props)) {
      if (k === 'model_path' || k === 'workspace_dir') {
        continue;
      }
      const field = jsonSchemaPropToZod(propSchema || {});
      shape[k] = required.has(k) ? field : field.optional();
    }
  }
  return shape;
}

export function buildTypedBlockSetZodShape(blockSchema?: Record<string, unknown>): Record<string, ZodTypeAny> {
  const baseShape = jsonSchemaToZodShape(blockSchema);
  const entryShape: Record<string, ZodTypeAny> = {};
  for (const [k, field] of Object.entries(baseShape)) {
    if (!SET_BLOCK_META_KEYS.has(k)) {
      entryShape[k] = field;
    }
  }
  return {
    model_path: z.string().describe('Path to the .ros2 or .rossystem file.'),
    ...entryShape,
    target_kind: z
      .enum(['System', 'RosNode', 'Node', 'Plugin', 'RosInterface'])
      .optional()
      .describe('Target metamodel element kind.'),
    target_name: z.string().optional().describe('Name of the target element.'),
    artifact_name: z.string().optional().describe('Optional enclosing Artifact name.'),
    remove: z.boolean().optional().default(false).describe('If true, removes this @<block>: from the target element.'),
    workspace_dir: z.string().optional().describe('Optional workspace root directory.'),
  };
}

function sanitizeIdSegment(raw: string): string {
  return raw.replace(/[^A-Za-z0-9_-]/g, '_');
}

async function executeSetExtensionBlock(
  deps: PluginLspDeps,
  params: {
    model_path: string;
    block_name: string;
    entries: Record<string, unknown>;
    target_kind?: string;
    target_name?: string;
    artifact_name?: string;
    remove?: boolean;
    workspace_dir?: string;
  }
) {
  const absModelPath = path.resolve(params.model_path);
  if (!fs.existsSync(absModelPath)) {
    return {
      isError: true,
      content: [{ type: 'text' as const, text: JSON.stringify({ error: `Model file not found at: ${absModelPath}` }) }],
    };
  }
  const rootDir = deps.resolveWorkspaceDir(absModelPath, params.workspace_dir);
  const client = await deps.getClient(rootDir);
  await deps.openCompanionFiles(client, path.dirname(absModelPath));
  const currentText = await fsp.readFile(absModelPath, 'utf-8');
  await client.openDocument(absModelPath, undefined, currentText);

  const res = await client.executeCommand<{
    success?: boolean;
    updatedText?: string;
    errors?: string[];
    warnings?: string[];
    error?: string;
  }>('rostooling.setExtensionBlock', [
    {
      fileUri: pathToFileURL(absModelPath).href,
      modelPath: absModelPath,
      modelText: currentText,
      blockName: params.block_name,
      targetKind: params.target_kind,
      targetName: params.target_name,
      artifactName: params.artifact_name,
      entries: params.entries,
      remove: params.remove ?? false,
    },
  ]);

  if (res?.success && typeof res.updatedText === 'string') {
    await fsp.writeFile(absModelPath, res.updatedText, 'utf-8');
    await client.openDocument(absModelPath, undefined, res.updatedText);
  }

  return {
    ...(res?.success === false || res?.error ? { isError: true } : {}),
    content: [{ type: 'text' as const, text: JSON.stringify(res, null, 2) }],
  };
}

export async function syncDynamicPluginsWithServer(
  server: McpServer,
  client: HeadlessLspClient,
  deps: PluginLspDeps,
  registeredTools: Set<string>,
  registeredResources: Set<string>,
  notifyIfConnected = true
): Promise<ListPluginsResponse> {
  const listed = (await client.executeCommand<ListPluginsResponse>('rostooling.listPluginTools', [])) || {};
  let addedTool = false;
  let addedResource = false;

  for (const plugin of listed.plugins || []) {
    const doc = (plugin.documentationMarkdown || '').trim();
    const resUri = `rostooling://plugin/${plugin.id}/docs`;
    if (doc && !registeredResources.has(resUri)) {
      registeredResources.add(resUri);
      addedResource = true;
      server.resource(
        `plugin_docs_${plugin.id.replace(/[^A-Za-z0-9_-]/g, '_')}`,
        resUri,
        {
          description: `Documentation for RosTooling plugin ${plugin.id}`,
          mimeType: 'text/markdown',
        },
        async (uri) => ({
          contents: [
            {
              uri: uri.href,
              mimeType: 'text/markdown',
              text: doc,
            },
          ],
        })
      );
    }

    for (const block of plugin.blocks || []) {
      const cleanBlockName = (block.name || '').replace(/^@+/, '');
      if (!cleanBlockName) {
        continue;
      }
      const setToolName =
        block.setToolName || `${sanitizeIdSegment(plugin.id)}__set_${sanitizeIdSegment(cleanBlockName)}`;
      if (registeredTools.has(setToolName)) {
        continue;
      }
      registeredTools.add(setToolName);
      addedTool = true;
      const typedShape = buildTypedBlockSetZodShape(block.schema);
      const allowedLocs =
        block.allowedLocations && block.allowedLocations.length > 0
          ? ` Allowed locations: ${block.allowedLocations.join(', ')}.`
          : '';
      server.tool(
        setToolName,
        `[${plugin.id}] Typed setter for @${cleanBlockName}: extension block.${block.description ? ` ${block.description}` : ''}${allowedLocs}`,
        typedShape,
        async (rawArgs: Record<string, unknown>) => {
          const entries: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(rawArgs)) {
            if (!SET_BLOCK_META_KEYS.has(k) && v !== undefined) {
              entries[k] = v;
            }
          }
          return executeSetExtensionBlock(deps, {
            model_path: String(rawArgs.model_path || ''),
            block_name: cleanBlockName,
            entries,
            target_kind: typeof rawArgs.target_kind === 'string' ? rawArgs.target_kind : undefined,
            target_name: typeof rawArgs.target_name === 'string' ? rawArgs.target_name : undefined,
            artifact_name: typeof rawArgs.artifact_name === 'string' ? rawArgs.artifact_name : undefined,
            remove: Boolean(rawArgs.remove),
            workspace_dir: typeof rawArgs.workspace_dir === 'string' ? rawArgs.workspace_dir : undefined,
          });
        }
      );
    }
  }

  for (const tool of listed.tools || []) {
    if (!tool.prefixedName || registeredTools.has(tool.prefixedName)) {
      continue;
    }
    registeredTools.add(tool.prefixedName);
    addedTool = true;
    const zodShape = jsonSchemaToZodShape(tool.inputSchema);
    server.tool(
      tool.prefixedName,
      `[${tool.pluginId}] ${tool.description}`,
      zodShape,
      async (rawArgs: Record<string, unknown>) => {
        const modelPath = typeof rawArgs.model_path === 'string' ? rawArgs.model_path : undefined;
        const workspaceDirArg = typeof rawArgs.workspace_dir === 'string' ? rawArgs.workspace_dir : undefined;
        const absModelPath = modelPath ? path.resolve(modelPath) : undefined;
        const rootDir = absModelPath
          ? deps.resolveWorkspaceDir(absModelPath, workspaceDirArg)
          : (workspaceDirArg ? path.resolve(workspaceDirArg) : deps.workspaceDir() || process.cwd());
        const activeClient = await deps.getClient(rootDir);

        let fileUri: string | undefined;
        let modelText: string | undefined;
        if (absModelPath && fs.existsSync(absModelPath)) {
          await deps.openCompanionFiles(activeClient, path.dirname(absModelPath));
          modelText = await fsp.readFile(absModelPath, 'utf-8');
          const ext = path.extname(absModelPath).replace(/^\./, '');
          await activeClient.openDocument(absModelPath, ext, modelText);
          fileUri = pathToFileURL(absModelPath).href;
        }

        const forwardedArgs = { ...rawArgs };
        delete forwardedArgs.model_path;
        delete forwardedArgs.workspace_dir;

        const res = await activeClient.executeCommand<{
          success?: boolean;
          message?: string;
          updatedText?: string;
          data?: Record<string, unknown>;
          errors?: string[];
          error?: string;
        }>('rostooling.executePluginTool', [
          {
            pluginId: tool.pluginId,
            toolName: tool.name,
            prefixedName: tool.prefixedName,
            fileUri,
            modelPath: absModelPath,
            modelText,
            arguments: forwardedArgs,
          },
        ]);

        if (res?.updatedText && absModelPath) {
          await fsp.writeFile(absModelPath, res.updatedText, 'utf-8');
        }

        return {
          ...(res?.success === false || res?.error ? { isError: true } : {}),
          content: [{ type: 'text', text: JSON.stringify(res, null, 2) }],
        };
      }
    );
  }

  if (notifyIfConnected && server.isConnected()) {
    if (addedTool) server.sendToolListChanged();
    if (addedResource) server.sendResourceListChanged();
  }
  return listed;
}

export function registerPluginTools(
  server: McpServer,
  deps: PluginLspDeps,
  registeredTools: Set<string>,
  registeredResources: Set<string>
): void {
  server.tool(
    'ros_list_plugins',
    'Lists active RosTooling plugins, their @<block>: schemas, contributed MCP tools, documentation URIs, and any plugin load errors.',
    {
      workspace_dir: z
        .string()
        .optional()
        .describe('Workspace root directory used to start the language server if not yet running.'),
    },
    async ({ workspace_dir }) => {
      const root = workspace_dir ? path.resolve(workspace_dir) : deps.workspaceDir() || process.cwd();
      const client = await deps.getClient(root);
      const listed = await syncDynamicPluginsWithServer(
        server,
        client,
        deps,
        registeredTools,
        registeredResources,
        true
      );
      return {
        content: [{ type: 'text', text: JSON.stringify(listed, null, 2) }],
      };
    }
  );

  server.tool(
    'ros_get_extension_block',
    'Reads an @<block>: extension block from a .ros2 or .rossystem element as structured JSON along with its schema and validation issues.',
    {
      model_path: z.string().describe('Path to the .ros2 or .rossystem file.'),
      block_name: z.string().describe("Extension block name (e.g. 'audit' or '@audit')."),
      target_kind: z
        .enum(['System', 'RosNode', 'Node', 'Plugin', 'RosInterface'])
        .optional()
        .describe('Target metamodel element kind (optional if target_name uniquely identifies it).'),
      target_name: z
        .string()
        .optional()
        .describe("Name of the target System, RosNode, Node, Plugin, or RosInterface ('node::iface')."),
      artifact_name: z.string().optional().describe('Optional enclosing Artifact name when disambiguating .ros2 nodes.'),
      merged: z
        .boolean()
        .optional()
        .default(false)
        .describe('When true on a RosNode, returns the merged view combining type-level (.ros2) and instance-level (.rossystem) entries.'),
      workspace_dir: z.string().optional().describe('Optional workspace root directory.'),
    },
    async ({ model_path, block_name, target_kind, target_name, artifact_name, merged, workspace_dir }) => {
      const absModelPath = path.resolve(model_path);
      if (!fs.existsSync(absModelPath)) {
        return {
          isError: true,
          content: [{ type: 'text', text: JSON.stringify({ error: `Model file not found at: ${absModelPath}` }) }],
        };
      }
      const rootDir = deps.resolveWorkspaceDir(absModelPath, workspace_dir);
      const client = await deps.getClient(rootDir);
      await deps.openCompanionFiles(client, path.dirname(absModelPath));
      await client.openDocument(absModelPath);

      const res = await client.executeCommand<Record<string, unknown>>('rostooling.getExtensionBlock', [
        {
          fileUri: pathToFileURL(absModelPath).href,
          modelPath: absModelPath,
          blockName: block_name,
          targetKind: target_kind,
          targetName: target_name,
          artifactName: artifact_name,
          merged,
        },
      ]);
      return {
        ...(res?.error ? { isError: true } : {}),
        content: [{ type: 'text', text: JSON.stringify(res, null, 2) }],
      };
    }
  );

  server.tool(
    'ros_set_extension_block',
    'Validates and writes, updates, or removes an @<block>: extension block on a .ros2 or .rossystem element.',
    {
      model_path: z.string().describe('Path to the .ros2 or .rossystem file.'),
      block_name: z.string().describe("Extension block name (e.g. 'audit' or '@audit')."),
      entries: z
        .record(z.string(), z.unknown())
        .optional()
        .default({})
        .describe('Key/value entries map conforming to the block EClass schema.'),
      target_kind: z
        .enum(['System', 'RosNode', 'Node', 'Plugin', 'RosInterface'])
        .optional()
        .describe('Target metamodel element kind.'),
      target_name: z.string().optional().describe('Name of the target element.'),
      artifact_name: z.string().optional().describe('Optional enclosing Artifact name.'),
      remove: z.boolean().optional().default(false).describe('If true, removes the @<block>: from the target element.'),
      workspace_dir: z.string().optional().describe('Optional workspace root directory.'),
    },
    async ({ model_path, block_name, entries, target_kind, target_name, artifact_name, remove, workspace_dir }) =>
      executeSetExtensionBlock(deps, {
        model_path,
        block_name,
        entries,
        target_kind,
        target_name,
        artifact_name,
        remove,
        workspace_dir,
      })
  );

  server.tool(
    'generate_plugin_outputs',
    'Runs Phase A core generation and Phase B active plugin generators for a .ros2 package, applies single-author build merging, and writes outputs to src-gen/.',
    {
      model_path: z.string().describe('Path to the .ros2 model file.'),
      target_nodes: z.array(z.string()).optional().describe('Optional specific artifact/node/plugin names to generate.'),
      language: z.enum(['cpp', 'python', 'both']).optional().default('both'),
      ros_distro: z.string().optional().default('auto'),
      workspace_dir: z.string().optional().describe('Workspace root containing src-gen/.'),
    },
    async ({ model_path, target_nodes, language, ros_distro, workspace_dir }) => {
      const absModelPath = path.resolve(model_path);
      if (!fs.existsSync(absModelPath) || !absModelPath.endsWith('.ros2')) {
        return {
          isError: true,
          content: [{ type: 'text', text: JSON.stringify({ error: `Valid .ros2 file not found at: ${absModelPath}` }) }],
        };
      }

      const rootDir = deps.resolveWorkspaceDir(absModelPath, workspace_dir);
      const srcGenDir = path.join(rootDir, 'src-gen');
      await fsp.mkdir(srcGenDir, { recursive: true });

      const docText = await fsp.readFile(absModelPath, 'utf-8');
      const [described] = await GlspClientBridge.getInstance().requestRosIndex([absModelPath]);
      const pkg = described?.packages?.[0];
      const pkgName = pkg?.name || path.basename(absModelPath, '.ros2');
      const allNodesInFile = (pkg?.artifacts || []).map((a) => ({
        artifactName: a.artifact,
        nodeName: a.node,
      }));
      const nodesToProcess =
        target_nodes && target_nodes.length > 0
          ? allNodesInFile.filter((n) => target_nodes.includes(n.artifactName) || target_nodes.includes(n.nodeName))
          : allNodesInFile;

      if (language === 'cpp' || language === 'python') {
        for (const n of nodesToProcess) {
          await cleanOppositeLanguageFiles(srcGenDir, pkgName, n, language);
        }
      }

      const pkgDir = path.join(srcGenDir, pkgName);
      const existingFiles = await scanExistingFiles(pkgDir, pkgName);

      const client = await deps.getClient(rootDir);
      await deps.openCompanionFiles(client, path.dirname(absModelPath));
      await client.openDocument(absModelPath, 'ros2', docText);

      const res = await client.executeCommand<{
        success?: boolean;
        files?: Record<string, string>;
        coreFiles?: Record<string, string>;
        pluginFiles?: Record<string, string>;
        prunedFiles?: string[];
        errors?: string[];
        conflictErrors?: string[];
        distro?: string;
        error?: string;
      }>('rostooling.generatePluginOutputs', [
        {
          fileUri: pathToFileURL(absModelPath).href,
          modelPath: absModelPath,
          targetNodes: target_nodes || [],
          language,
          distro: ros_distro,
          existingFiles,
        },
      ]);

      if (res?.error || (res?.errors && res.errors.length > 0)) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  status: 'error',
                  error: res.error || res.errors?.join('; '),
                  errors: res.errors || [],
                  conflictErrors: res.conflictErrors || [],
                },
                null,
                2
              ),
            },
          ],
        };
      }

      const prunedDeleted: string[] = [];
      for (const rel of res.prunedFiles || []) {
        const cleanRel = rel.replace(/^DEFAULT_OUTPUT/, '');
        if (!cleanRel || cleanRel.includes('..') || path.isAbsolute(cleanRel)) {
          continue;
        }
        const targetFile = path.resolve(srcGenDir, cleanRel);
        if (targetFile.startsWith(path.resolve(srcGenDir) + path.sep) && fs.existsSync(targetFile)) {
          await fsp.unlink(targetFile).catch(() => undefined);
          prunedDeleted.push(cleanRel);
        }
      }

      const postRes = await processAndWriteFiles(srcGenDir, res.files || {}, false);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                status: 'success',
                package: pkgName,
                distro: res.distro,
                workspaceDir: rootDir,
                outputDir: pkgDir,
                writtenCount: postRes.writtenFiles.length,
                skippedCount: postRes.skippedFiles.length,
                writtenFiles: postRes.writtenFiles,
                skippedFiles: postRes.skippedFiles,
                pluginFiles: Object.keys(res.pluginFiles || {}).map((k) => k.replace(/^DEFAULT_OUTPUT/, '')),
                prunedFiles: prunedDeleted,
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
}
