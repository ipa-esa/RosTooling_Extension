'use_strict';

import * as path from 'path';
import * as cp from 'child_process';
import * as fs from 'node:fs';
import { window, workspace, ExtensionContext, commands, Uri, OutputChannel, SnippetString, FileType } from 'vscode';
import { LanguageClient, LanguageClientOptions, ServerOptions, Trace, ErrorHandlerResult, ErrorAction, Message, CloseHandlerResult, CloseAction } from 'vscode-languageclient/node';
import { spawn } from 'node:child_process';
import * as os from 'os';
import { RosCustomEditorProvider } from './editor/RosCustomEditorProvider';
import { RosCatalogueManager } from './model/RosCatalogueManager';
import { RosModelParser } from './model/RosModelParser';

function checkJavaVersion(javaExecutable: string): Promise<boolean> {
    return new Promise((resolve) => {
        cp.exec(`"${javaExecutable}" -version`, (error, stdout, stderr) => {
            const output = stdout.toString() + stderr.toString();
            const match = output.match(/version "(\d+)\./);

            if (match && match[1]) {
                const majorVersion = parseInt(match[1], 10);
                if (majorVersion >= 17) {
                    resolve(true);
                    return;
                }
            }
            resolve(false);
        });
    });
}

let lc: LanguageClient;

export async function activate(context: ExtensionContext) {
    const tActivationStart = performance.now();
    const outputChannel = window.createOutputChannel('ROS LSP');
    outputChannel.show(true);
    outputChannel.appendLine('Initializing ROS LSP client');


    const extensionVersion = context.extension.packageJSON.version;
    const jarPath = context.asAbsolutePath(path.join('server', `rostooling_extension-${extensionVersion}.jar`));

    const config = workspace.getConfiguration('rostooling-languages');
    let javaExecutable = 'java';
    outputChannel.appendLine(`Using Java executable: ${javaExecutable}`);
    const javaHome = config.get<string>('java.home');
    if (javaHome) {
        javaExecutable = path.join(javaHome, 'bin', 'java');
    }
    outputChannel.appendLine("Verifying java version");
    const tJavaStart = performance.now();
    const isJavaValid = await checkJavaVersion(javaExecutable);
    const tJavaElapsed = Math.round(performance.now() - tJavaStart);
    if (!isJavaValid) {
        window.showErrorMessage(
            "ROS Tooling requires Java 17 or higher to run. Please update your Java installation or point the extension to a modern JDK.",
            "Open Settings",
            "Download Java"
        ).then(selection => {
            if (selection === "Open Settings") {
                commands.executeCommand('workbench.action.openSettings', 'rostooling-languages.java.home');
            } else if (selection === "Download Java") {
                import('vscode').then(vscode => {
                    vscode.env.openExternal(vscode.Uri.parse('https://adoptium.net/'))
                });
            }
        });

        outputChannel.appendLine('ABORTED: Invalid Java version detected.');
        return;
    }
    outputChannel.appendLine(`Java version is valid (${tJavaElapsed}ms)`);

    const tCatStart = performance.now();
    const storageDir = context.globalStorageUri
        ? path.join(context.globalStorageUri.fsPath, 'catalogue_repos')
        : path.join(os.homedir(), '.rostooling', 'catalogue_repos');
    const catalogueManager = RosCatalogueManager.getInstance(storageDir);
    const cataloguePath = catalogueManager.getStorageDir();
    outputChannel.appendLine(`Catalogue storage path: ${cataloguePath}`);

    // Ensure default catalogue repositories exist before launching LSP server
    const fallbackDir = path.join(os.homedir(), '.rostooling', 'catalogue_repos');
    for (const repo of RosCatalogueManager.DEFAULT_REPOSITORIES) {
        const targetRepoDir = path.join(cataloguePath, repo.name);
        const fallbackRepoDir = path.join(fallbackDir, repo.name);
        if (!fs.existsSync(targetRepoDir) && fs.existsSync(fallbackRepoDir)) {
            try {
                outputChannel.appendLine(`Copying cached catalogue ${repo.name} from fallback directory...`);
                fs.cpSync(fallbackRepoDir, targetRepoDir, { recursive: true });
            } catch (err) {
                outputChannel.appendLine(`Failed to copy fallback catalogue ${repo.name}: ${err}`);
            }
        }
    }

    const hasAllCatalogues = RosCatalogueManager.DEFAULT_REPOSITORIES.every(
        repo => fs.existsSync(path.join(cataloguePath, repo.name))
    );
    if (!hasAllCatalogues) {
        outputChannel.appendLine('Synchronizing missing default catalogue repositories...');
        try {
            await catalogueManager.syncRepositories(false, (msg) => outputChannel.appendLine(`[Catalogue] ${msg}`));
        } catch (err) {
            outputChannel.appendLine(`Catalogue sync warning: ${err}`);
        }
    } else {
        catalogueManager.syncRepositories(false).catch((err) => {
            outputChannel.appendLine(`Background catalogue sync warning: ${err}`);
        });
    }

    const serverOptions: ServerOptions = {
        run: {
            command: javaExecutable,
            args: [
                '--add-opens=java.base/java.lang=ALL-UNNAMED',
                '--add-opens=java.base/java.util=ALL-UNNAMED',
                `-Drostooling.catalogue.path=${cataloguePath}`,
                '-jar', jarPath
            ]
        },
        debug: {
            command: javaExecutable,
            args: [
                '--add-opens=java.base/java.lang=ALL-UNNAMED',
                '--add-opens=java.base/java.util=ALL-UNNAMED',
                `-Drostooling.catalogue.path=${cataloguePath}`,
                '-jar', jarPath,
                '-Dorg.eclipse.equinox.simpleconfigurator.location=/tmp'  // optional debug flag
            ]
        }
    };

    const documentSelector = [
        { scheme: 'file', language: 'ros' },
        { scheme: 'file', language: 'ros1' },
        { scheme: 'file', language: 'ros2' },
        { scheme: 'file', language: 'rossystem' },
    ];

    const clientOptions: LanguageClientOptions = {
        documentSelector,
        synchronize: {
            configurationSection: 'rostooling-languages',
            fileEvents: workspace.createFileSystemWatcher('**/*.{ros,ros1,ros2,rossystem}')
        },
        outputChannel: outputChannel,
        outputChannelName: 'ROS LSP',
        errorHandler: {
            error: (_error: Error, _message?: Message, count?: number): ErrorHandlerResult => {
                console.error(`LSP Error #${count}:`, _error.message);
                window.showErrorMessage(`ROS LSP error: ${_error.message}`);
                return {
                    action: (count || 0) < 5 ? ErrorAction.Continue : ErrorAction.Shutdown,
                };
            },
            closed: (): CloseHandlerResult => {
                console.log('ROS LSP closed');
                window.showWarningMessage('ROS LSP server stopped');
                return {
                    action: CloseAction.Restart,
                };
            }
        },
        middleware: {
            provideCompletionItem: async (document, position, context, token, next) => {
                const result = await next(document, position, context, token);
                if (!result) return result;
                const lineText = document.lineAt(position.line).text;
                const textBeforeCursor = lineText.substring(0, position.character).trim();
                const hasStartingQuote = textBeforeCursor.endsWith('"') || textBeforeCursor.endsWith("'");

                const items = Array.isArray(result) ? result : result.items;
                for (const item of items) {
                    const itemLabel = item.label != null ? item.label.toString() : "None";
                    const isReferenceOrValue = item.kind === 17

                    if (isReferenceOrValue && !hasStartingQuote) {
                        let textToInsert = '';
                        if (typeof item.insertText === 'string') {
                            textToInsert = item.insertText;
                        } else if (item.insertText instanceof SnippetString) {
                            textToInsert = item.insertText.value;
                        } else {
                            textToInsert = itemLabel;
                        }

                        const isNumberOrBool = !isNaN(Number(textToInsert)) || textToInsert === 'true' || textToInsert === 'false';

                        if (!isNumberOrBool) {
                            textToInsert = textToInsert.replace(/^"|"$/g, '');
                            if (!hasStartingQuote) {
                                textToInsert = `"${textToInsert}"`;
                            }

                            if (item.insertText instanceof SnippetString) {
                                item.insertText.value = textToInsert;
                            } else {
                                item.insertText = textToInsert;
                            }
                        }
                    }
                }

                return result;
            }
        }
    };

    lc = new LanguageClient('rostooling-languages', serverOptions, clientOptions);

    // Tracing
    const trace = workspace.getConfiguration('rostooling-languages').get('server.trace') as string;
    lc.setTrace(trace === 'verbose' ? Trace.Verbose : trace === 'messages' ? Trace.Messages : Trace.Off);
    context.subscriptions.push(lc);

    const tLspStart = performance.now();
    try {
        await lc.start();
        const tLspElapsed = Math.round(performance.now() - tLspStart);
        outputChannel.appendLine(`Rostooling LSP Server started successfully in ${tLspElapsed}ms`);
    } catch (error) {
        outputChannel.appendLine(`Failed to start server: ${error}`);
    }

    const safeRegisterCommand = (commandId: string, callback: Parameters<typeof commands.registerCommand>[1]) => {
        try {
            const cmd = commands.registerCommand(commandId, callback);
            context.subscriptions.push(cmd);
            return cmd;
        } catch (err) {
            console.warn(`Command '${commandId}' was already registered or failed to register:`, err);
            return undefined;
        }
    };

    safeRegisterCommand('rossystem.triggerCodeGeneration', async (uri?: Uri) => {
        if (!lc) {
            window.showErrorMessage('ROS LSP not ready');
            return;
        }

        let targetUri = uri;
        if (!targetUri && window.activeTextEditor) {
            targetUri = window.activeTextEditor.document.uri;
        }
        if (!targetUri) {
            const activeTab = window.tabGroups?.activeTabGroup?.activeTab;
            if (activeTab?.input && typeof activeTab.input === 'object' && 'uri' in activeTab.input && (activeTab.input as { uri: unknown }).uri instanceof Uri) {
                targetUri = (activeTab.input as { uri: Uri }).uri;
            }
        }
        if (!targetUri && RosCustomEditorProvider.activeCustomDocument) {
            targetUri = RosCustomEditorProvider.activeCustomDocument.uri;
        }

        if (!targetUri) {
            window.showErrorMessage('No active ROS editor or model file selected');
            return;
        }

        const doc = workspace.textDocuments.find(d => d.uri.toString() === targetUri.toString());
        if (doc?.isDirty) {
            await doc.save();
        }

        try {
            const targetUriStr = targetUri.toString();
            const filedEnd = targetUriStr.split('.').pop();
            if (filedEnd !== 'rossystem') {
                window.showErrorMessage('File is not a ROS system file');
                return;
            }
            const workspaceFolder = workspace.getWorkspaceFolder(targetUri);
            if (!workspaceFolder) {
                window.showErrorMessage('Current file is not inside workspace folder. Cannot create src-gen');
                return;
            }

            const existingFiles: string[] = [];
            try {
                const srcGenUri = Uri.joinPath(workspaceFolder.uri, 'src-gen');
                const scanDir = async (dir: Uri, prefix = '') => {
                    try {
                        const entries = await workspace.fs.readDirectory(dir);
                        for (const [name, type] of entries) {
                            const relPath = prefix ? `${prefix}/${name}` : name;
                            if (type === FileType.Directory) {
                                await scanDir(Uri.joinPath(dir, name), relPath);
                            } else if (type === FileType.File) {
                                existingFiles.push(relPath);
                            }
                        }
                    } catch {
                        // Ignore non-existent folder
                    }
                };
                await scanDir(srcGenUri);
            } catch {
                // src-gen might not exist yet
            }

            console.log('Sending execute Command to server...');
            const result = await lc.sendRequest<{ files?: Record<string, string>, error?: string }>('workspace/executeCommand', {
                command: 'rossystem.generateCode',
                arguments: [targetUriStr, existingFiles]
            });

            // Safe access
            const files = result?.files || {};
            const count = Object.keys(files).length;

            if (result?.error) {
                window.showErrorMessage(`Generation error: ${result.error}`);
            } else if (count > 0) {
                const srcGenUri = Uri.joinPath(workspaceFolder.uri, 'src-gen');

                // Prune redundant build and setup files across generated packages
                const affectedPkgs = new Set<string>();
                for (const rawPath of Object.keys(files)) {
                    const cleanPath = rawPath.replace(/^DEFAULT_OUTPUT\/?/, '');
                    const pkg = cleanPath.split('/')[0];
                    if (pkg) {
                        affectedPkgs.add(pkg);
                    }
                }

                for (const pkg of affectedPkgs) {
                    const hasCMakeInFiles = Object.keys(files).some(k => {
                        const cp = k.replace(/^DEFAULT_OUTPUT\/?/, '');
                        return cp === `${pkg}/CMakeLists.txt`;
                    });

                    let hasExistingCMake = false;
                    let hasExistingCpp = false;
                    let hasExistingSetup = false;
                    try {
                        const entries = await workspace.fs.readDirectory(Uri.joinPath(srcGenUri, pkg));
                        hasExistingCMake = entries.some(([n]) => n === 'CMakeLists.txt');
                        hasExistingCpp = entries.some(([n]) => n === 'src');
                        hasExistingSetup = entries.some(([n]) => n === 'setup.py');
                    } catch {
                        // Directory does not exist yet
                    }

                    const isPurePython = hasExistingSetup && !hasExistingCpp && !hasExistingCMake && !hasCMakeInFiles;
                    await cleanRedundantBuildFiles(srcGenUri, pkg, !isPurePython);
                }

                let writtenCount = 0;
                for (const [rawPath, content] of Object.entries(files)) {
                    const cleanPath = rawPath.replace(/^DEFAULT_OUTPUT\/?/, '');
                    const filePath = Uri.joinPath(srcGenUri, cleanPath);

                    // Overwrite protection:
                    // 1. If cleanPath is CMakeLists.txt and target has C++ node targets, do not overwrite with bare system CMakeLists.txt!
                    if (cleanPath.endsWith('CMakeLists.txt')) {
                        try {
                            const existingBytes = await workspace.fs.readFile(filePath);
                            const existingText = new TextDecoder().decode(existingBytes);
                            if (existingText.includes('add_library') || existingText.includes('add_executable')) {
                                console.log(`Preserving existing node wrapper CMakeLists.txt at ${cleanPath}`);
                                continue;
                            }
                        } catch {
                            // File does not exist
                        }

                        // Also do not write CMakeLists.txt if target package is a pure Python package
                        const pkgName = cleanPath.split('/')[0];
                        const pkgDir = Uri.joinPath(srcGenUri, pkgName);
                        try {
                            const entries = await workspace.fs.readDirectory(pkgDir);
                            const hasSetup = entries.some(([n]) => n === 'setup.py');
                            const hasCpp = entries.some(([n]) => n === 'src');
                            if (hasSetup && !hasCpp) {
                                console.log(`Skipping CMakeLists.txt generation for pure Python package ${pkgName}`);
                                continue;
                            }
                        } catch {
                            // Directory does not exist yet
                        }
                    }

                    // 2. If cleanPath is setup.py and existing setup.py has console_scripts, do not overwrite!
                    if (cleanPath.endsWith('setup.py')) {
                        try {
                            const existingBytes = await workspace.fs.readFile(filePath);
                            const existingText = new TextDecoder().decode(existingBytes);
                            if (existingText.includes('console_scripts')) {
                                console.log(`Preserving existing Python wrapper setup.py at ${cleanPath}`);
                                continue;
                            }
                        } catch {
                            // File does not exist
                        }
                    }

                    // 3. If cleanPath is package.xml and existing package.xml has custom dependencies, do not overwrite!
                    if (cleanPath.endsWith('package.xml')) {
                        try {
                            const existingBytes = await workspace.fs.readFile(filePath);
                            const existingText = new TextDecoder().decode(existingBytes);
                            if (existingText.includes('<depend>') || existingText.includes('<buildtool_depend>')) {
                                console.log(`Preserving existing node wrapper package.xml at ${cleanPath}`);
                                continue;
                            }
                        } catch {
                            // File does not exist
                        }
                    }

                    // Do not write Python setuptools resource marker for CMake packages, but DO write .puml
                    const pkg = cleanPath.split('/')[0];
                    if (cleanPath === `${pkg}/resource/${pkg}`) {
                        const hasCMakeInFiles = Object.keys(files).some(k => k.replace(/^DEFAULT_OUTPUT\/?/, '') === `${pkg}/CMakeLists.txt`);
                        let isCMake = hasCMakeInFiles;
                        if (!isCMake) {
                            try {
                                const entries = await workspace.fs.readDirectory(Uri.joinPath(srcGenUri, pkg));
                                isCMake = entries.some(([n]) => n === 'CMakeLists.txt' || n === 'src');
                            } catch {
                                // Ignore
                            }
                        }
                        if (isCMake) {
                            console.log(`Skipping writing redundant setuptools resource marker for CMake package: ${cleanPath}`);
                            continue;
                        }
                    }

                    const encoder = new TextEncoder();
                    await workspace.fs.writeFile(filePath, encoder.encode(content));
                    writtenCount++;
                }

                // Ensure all generated CMake packages include installation directives for launch/ and config/, and package.xml has launch dependencies
                for (const pkg of affectedPkgs) {
                    await ensureLaunchInstallInCMake(srcGenUri, pkg);
                    await ensureLaunchDepsInPackageXml(srcGenUri, pkg);
                }

                window.showInformationMessage(`Successfully generated and wrote ${writtenCount} file(s) to src-gen/`);
            } else {
                window.showInformationMessage('No files generated');
            }

            console.log('Full result:', result);
        } catch (error) {
            window.showErrorMessage(`Command failed: ${error}`);
            console.error('Command failed:', error);
        }
    });

    safeRegisterCommand('ros2.generateWrappers', async (uri?: Uri, targetNodes?: unknown, langChoice?: string) => {
        if (!lc) {
            window.showErrorMessage('ROS LSP not ready');
            return;
        }

        let targetUri = uri;
        if (!targetUri && window.activeTextEditor) {
            targetUri = window.activeTextEditor.document.uri;
        }
        if (!targetUri) {
            const activeTab = window.tabGroups?.activeTabGroup?.activeTab;
            if (activeTab?.input && typeof activeTab.input === 'object' && 'uri' in activeTab.input && (activeTab.input as { uri: unknown }).uri instanceof Uri) {
                targetUri = (activeTab.input as { uri: Uri }).uri;
            }
        }
        if (!targetUri && RosCustomEditorProvider.activeCustomDocument) {
            targetUri = RosCustomEditorProvider.activeCustomDocument.uri;
        }

        if (!targetUri) {
            window.showErrorMessage('No active ROS 2 editor or model file selected');
            return;
        }

        const targetUriStr = targetUri.toString();
        const filedEnd = targetUriStr.split('.').pop();
        if (filedEnd !== 'ros2') {
            window.showErrorMessage('File is not a ROS 2 (.ros2) model file');
            return;
        }

        const doc = workspace.textDocuments.find(d => d.uri.toString() === targetUri.toString());
        if (doc?.isDirty) {
            await doc.save();
        }

        // Resolve targetNodes: if invoked from context menu (where VS Code passes Uri[]),
        // or undefined/empty, pass an empty string array [] so the Xtend generator generates all nodes in the package.
        let resolvedTargetNodes: string[] = [];
        if (Array.isArray(targetNodes) && targetNodes.length > 0 && typeof targetNodes[0] === 'string') {
            resolvedTargetNodes = targetNodes as string[];
        } else {
            resolvedTargetNodes = [];
        }

        // 1. Resolve document text and parse package/nodes
        let docText = '';
        try {
            const rawBytes = await workspace.fs.readFile(targetUri);
            docText = new TextDecoder().decode(rawBytes);
        } catch {
            const d = workspace.textDocuments.find(d => d.uri.toString() === targetUri.toString());
            if (d) docText = d.getText();
        }

        const parsedProj = RosModelParser.parseRos2(docText, targetUri.fsPath);
        const pkgName = parsedProj.system?.name || 'ros_package';
        const allNodesInFile = (parsedProj.nodes || []).map(n => ({
            artifactName: n.artifact || n.label,
            nodeName: n.label
        }));

        let nodesToProcess = allNodesInFile;
        if (resolvedTargetNodes.length > 0) {
            const filtered = allNodesInFile.filter(n =>
                resolvedTargetNodes.includes(n.artifactName) ||
                resolvedTargetNodes.includes(n.nodeName) ||
                resolvedTargetNodes.includes(toCamelCase(n.artifactName)) ||
                resolvedTargetNodes.includes(toCamelCase(n.nodeName))
            );
            if (filtered.length > 0) {
                nodesToProcess = filtered;
            } else {
                nodesToProcess = resolvedTargetNodes.map(name => ({ artifactName: name, nodeName: name }));
            }
        }

        const nodeLangMap = new Map<string, 'cpp' | 'python'>();

        if (langChoice === 'cpp' || langChoice === 'python') {
            for (const node of nodesToProcess) {
                nodeLangMap.set(node.artifactName, langChoice);
            }
        } else if (nodesToProcess.length <= 1) {
            const nodeLabel = nodesToProcess.length === 1 ? `'${nodesToProcess[0].artifactName}'` : 'the package nodes';
            const picked = await window.showQuickPick([
                { label: '$(file-code) C++', description: 'Generate C++ wrapper, runner, and pure algorithm template', value: 'cpp' },
                { label: '$(symbol-keyword) Python', description: 'Generate Python wrapper, runner, and pure logic template', value: 'python' }
            ], {
                placeHolder: `Select implementation language for ${nodeLabel}`
            });
            if (!picked) return;
            for (const node of nodesToProcess) {
                nodeLangMap.set(node.artifactName, picked.value as 'cpp' | 'python');
            }
        } else {
            const picked = await window.showQuickPick([
                { label: '$(file-code) All C++', description: 'Generate C++ wrappers for all nodes in the package', value: 'all_cpp' },
                { label: '$(symbol-keyword) All Python', description: 'Generate Python wrappers for all nodes in the package', value: 'all_python' },
                { label: '$(gear) Configure per node...', description: 'Select language individually for each node', value: 'custom' }
            ], {
                placeHolder: `Select implementation language for package '${pkgName}' (${nodesToProcess.length} nodes)`
            });
            if (!picked) return;

            if (picked.value === 'all_cpp') {
                for (const node of nodesToProcess) {
                    nodeLangMap.set(node.artifactName, 'cpp');
                }
            } else if (picked.value === 'all_python') {
                for (const node of nodesToProcess) {
                    nodeLangMap.set(node.artifactName, 'python');
                }
            } else {
                for (const node of nodesToProcess) {
                    const nodePick = await window.showQuickPick([
                        { label: '$(file-code) C++', description: `Generate C++ wrapper, runner, and algorithm for '${node.artifactName}'`, value: 'cpp' },
                        { label: '$(symbol-keyword) Python', description: `Generate Python wrapper, runner, and logic for '${node.artifactName}'`, value: 'python' }
                    ], {
                        placeHolder: `Select implementation language for node '${node.artifactName}'`
                    });
                    if (!nodePick) return;
                    nodeLangMap.set(node.artifactName, nodePick.value as 'cpp' | 'python');
                }
            }
        }

        // 2. Scan workspace src-gen to find existing files in this package for hybrid package support
        const workspaceFolder = workspace.getWorkspaceFolder(targetUri);
        if (!workspaceFolder) {
            window.showErrorMessage('Current file is not inside workspace folder. Cannot create src-gen');
            return;
        }

        const srcGenUri = Uri.joinPath(workspaceFolder.uri, 'src-gen');

        // Prune obsolete opposite-language files for the selected nodes before scanning and generating
        for (const node of nodesToProcess) {
            const targetLang = nodeLangMap.get(node.artifactName) || 'cpp';
            await cleanOppositeLanguageFiles(srcGenUri, pkgName, node, targetLang);
        }

        const existingFiles: string[] = [];
        try {
            const scanDir = async (dir: Uri, prefix = '') => {
                try {
                    const entries = await workspace.fs.readDirectory(dir);
                    for (const [name, type] of entries) {
                        const relPath = prefix ? `${prefix}/${name}` : name;
                        if (type === FileType.Directory) {
                            await scanDir(Uri.joinPath(dir, name), relPath);
                        } else if (type === FileType.File) {
                            existingFiles.push(relPath);
                        }
                    }
                } catch {
                    // Ignore non-existent folder
                }
            };
            await scanDir(srcGenUri);
        } catch {
            // src-gen might not exist yet
        }

        const hostDistro = process.env.ROS_DISTRO || 'humble';
        const cppTargetNodes = nodesToProcess
            .filter(n => nodeLangMap.get(n.artifactName) === 'cpp')
            .map(n => n.artifactName);
        const pyTargetNodes = nodesToProcess
            .filter(n => nodeLangMap.get(n.artifactName) === 'python')
            .map(n => n.artifactName);

        const files: Record<string, string> = {};

        try {
            if (cppTargetNodes.length > 0 && pyTargetNodes.length === 0) {
                const result = await lc.sendRequest<{ files?: Record<string, string>, error?: string }>('workspace/executeCommand', {
                    command: 'ros2.generateWrappersServer',
                    arguments: [
                        targetUriStr,
                        resolvedTargetNodes.length > 0 ? cppTargetNodes : [],
                        'cpp',
                        hostDistro,
                        existingFiles
                    ]
                });
                if (result?.error) {
                    window.showErrorMessage(`Generation error: ${result.error}`);
                    return;
                }
                Object.assign(files, result?.files || {});
            } else if (pyTargetNodes.length > 0 && cppTargetNodes.length === 0) {
                const result = await lc.sendRequest<{ files?: Record<string, string>, error?: string }>('workspace/executeCommand', {
                    command: 'ros2.generateWrappersServer',
                    arguments: [
                        targetUriStr,
                        resolvedTargetNodes.length > 0 ? pyTargetNodes : [],
                        'python',
                        hostDistro,
                        existingFiles
                    ]
                });
                if (result?.error) {
                    window.showErrorMessage(`Generation error: ${result.error}`);
                    return;
                }
                Object.assign(files, result?.files || {});
            } else if (cppTargetNodes.length > 0 && pyTargetNodes.length > 0) {
                // Hybrid package generation in single run
                const resCpp = await lc.sendRequest<{ files?: Record<string, string>, error?: string }>('workspace/executeCommand', {
                    command: 'ros2.generateWrappersServer',
                    arguments: [
                        targetUriStr,
                        cppTargetNodes,
                        'cpp',
                        hostDistro,
                        existingFiles
                    ]
                });
                if (resCpp?.error) {
                    window.showErrorMessage(`Generation error: ${resCpp.error}`);
                    return;
                }
                Object.assign(files, resCpp?.files || {});

                const updatedExisting = Array.from(new Set([
                    ...existingFiles,
                    ...Object.keys(resCpp?.files || {}).map(p => p.replace(/^DEFAULT_OUTPUT\/?/, ''))
                ]));

                const resPy = await lc.sendRequest<{ files?: Record<string, string>, error?: string }>('workspace/executeCommand', {
                    command: 'ros2.generateWrappersServer',
                    arguments: [
                        targetUriStr,
                        pyTargetNodes,
                        'python',
                        hostDistro,
                        updatedExisting
                    ]
                });
                if (resPy?.error) {
                    window.showErrorMessage(`Generation error: ${resPy.error}`);
                    return;
                }
                Object.assign(files, resPy?.files || {});
            } else {
                // Fallback for empty package
                const fallbackLang = (nodeLangMap.values().next().value as string) || 'cpp';
                const result = await lc.sendRequest<{ files?: Record<string, string>, error?: string }>('workspace/executeCommand', {
                    command: 'ros2.generateWrappersServer',
                    arguments: [
                        targetUriStr,
                        [],
                        fallbackLang,
                        hostDistro,
                        existingFiles
                    ]
                });
                if (result?.error) {
                    window.showErrorMessage(`Generation error: ${result.error}`);
                    return;
                }
                Object.assign(files, result?.files || {});
            }

            const count = Object.keys(files).length;

            if (count > 0) {
                const srcGenUri = Uri.joinPath(workspaceFolder.uri, 'src-gen');

                // Automatically prune redundant build/setup files for each generated package
                const affectedPkgs = new Set<string>();
                for (const rawPath of Object.keys(files)) {
                    const cleanPath = rawPath.replace(/^DEFAULT_OUTPUT\/?/, '');
                    const pkg = cleanPath.split('/')[0];
                    if (pkg) {
                        affectedPkgs.add(pkg);
                    }
                }

                for (const pkg of affectedPkgs) {
                    const hasCMakeInFiles = Object.keys(files).some(k => {
                        const cp = k.replace(/^DEFAULT_OUTPUT\/?/, '');
                        return cp === `${pkg}/CMakeLists.txt`;
                    });
                    const hasCppInFiles = Object.keys(files).some(k => {
                        const cp = k.replace(/^DEFAULT_OUTPUT\/?/, '');
                        return cp.startsWith(`${pkg}/src/`) || cp.startsWith(`${pkg}/include/`);
                    });

                    let hasExistingCpp = false;
                    let hasExistingCMake = false;
                    try {
                        const entries = await workspace.fs.readDirectory(Uri.joinPath(srcGenUri, pkg));
                        hasExistingCMake = entries.some(([n]) => n === 'CMakeLists.txt');
                    } catch {
                        // Directory does not exist yet
                    }
                    try {
                        const srcEntries = await workspace.fs.readDirectory(Uri.joinPath(srcGenUri, pkg, 'src'));
                        hasExistingCpp = srcEntries.some(([n]) => n.endsWith('.cpp'));
                    } catch {
                        // src directory does not exist or empty
                    }

                    const isCMake = hasCMakeInFiles || hasCppInFiles || hasExistingCMake || hasExistingCpp;
                    await cleanRedundantBuildFiles(srcGenUri, pkg, isCMake);
                }

                let writtenCount = 0;
                for (const [rawPath, content] of Object.entries(files)) {
                    const cleanPath = rawPath.replace(/^DEFAULT_OUTPUT\/?/, '');
                    const filePath = Uri.joinPath(srcGenUri, cleanPath);

                    // Overwrite protection for user pure logic starter files
                    if (cleanPath.endsWith('Algorithm.hpp') || cleanPath.endsWith('_logic.py')) {
                        try {
                            await workspace.fs.stat(filePath);
                            // File already exists - DO NOT OVERWRITE
                            continue;
                        } catch {
                            // File does not exist, proceed to write
                        }
                    }

                    const encoder = new TextEncoder();
                    await workspace.fs.writeFile(filePath, encoder.encode(content));
                    writtenCount++;
                    if (process.platform !== 'win32' && (content.startsWith('#!') || cleanPath.endsWith('_runner.py'))) {
                        try {
                            fs.chmodSync(filePath.fsPath, 0o755);
                        } catch (err) {
                            console.warn(`Could not set executable permission on ${filePath.fsPath}:`, err);
                        }
                    }
                }

                // Ensure all generated CMake packages include installation directives for launch/ and config/ if launch files exist
                for (const pkg of affectedPkgs) {
                    await ensureLaunchInstallInCMake(srcGenUri, pkg);
                    await ensureLaunchDepsInPackageXml(srcGenUri, pkg);
                }

                window.showInformationMessage(`Successfully generated ${writtenCount} file(s) in src-gen/`);
            } else {
                window.showInformationMessage('No wrapper files generated');
            }
        } catch (error) {
            window.showErrorMessage(`Command failed: ${error}`);
            console.error('Command failed:', error);
        }
    });

    const customEditorProvider = new RosCustomEditorProvider(context);
    context.subscriptions.push(
        window.registerCustomEditorProvider(
            RosCustomEditorProvider.viewType,
            customEditorProvider,
            {
                webviewOptions: { retainContextWhenHidden: true },
                supportsMultipleEditorsPerDocument: false
            }
        )
    );

    safeRegisterCommand('rostooling.openVisualStudio', async (uri?: Uri) => {
        let targetUri = uri;
        if (!targetUri && window.activeTextEditor) {
            targetUri = window.activeTextEditor.document.uri;
        }
        if (!targetUri) {
            window.showErrorMessage('No active ROS model file selected to open in Visual Studio.');
            return;
        }
        await commands.executeCommand('vscode.openWith', targetUri, RosCustomEditorProvider.viewType);
    });

    safeRegisterCommand('rossdl.buildPackage', async () => {
        try {
            await runRossdlWorkflow(outputChannel);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            outputChannel.appendLine(`[ROSSDL error] ${message}`);
            outputChannel.show(true)
            window.showErrorMessage(message)
        }
    });

    const tTotalElapsed = Math.round(performance.now() - tActivationStart);
    outputChannel.appendLine(`[Benchmark] Total extension activation completed in ${tTotalElapsed}ms`);
}

export function deactivate(): Thenable<void> | undefined {
    if (!lc) {
        return undefined;
    }
    return lc.stop().catch((error) => {
        console.warn('Error stopping ROS LSP client during deactivation:', error);
    });
}

async function runRossdlWorkflow(outputChannel: OutputChannel): Promise<void> {
    outputChannel.show(true);

    const rossdlWorkspace = await pickFolder('Select ROSSDL Workspace', 'Select ROSSDL Workspace');
    if (!rossdlWorkspace) {
        window.showInformationMessage('No ROSSDL workspace selected, generation cancelled.');
        return;
    }
    validateRosWorkspace(rossdlWorkspace);
    outputChannel.appendLine(`Selected ROSSDL workspace: ${rossdlWorkspace}`);

    const buildWorkspace = await pickFolder('Select Build Workspace', 'Select Build Workspace');
    if (!buildWorkspace) {
        window.showInformationMessage('No build workspace selected, generation cancelled.');
        return;
    }
    outputChannel.appendLine(`Selected build workspace: ${buildWorkspace}`);
    const generationCommand = 'colcon build --symlink-install';

    await runShellCommand('bash', ['-lc', `source "${path.join(rossdlWorkspace, 'install', 'setup.bash')}" && ${generationCommand}`], buildWorkspace, 'Running ROSSDL generation command', outputChannel);

    window.showInformationMessage("Generation finished successfully.");
}

async function pickFolder(title: string, openLabel: string): Promise<string | undefined> {
    const selected = await window.showOpenDialog({
        title,
        openLabel,
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        defaultUri: workspace.workspaceFolders?.[0]?.uri
    });

    return selected?.[0]?.fsPath;
}

function validateRosWorkspace(folder: string): void {
    const srcPath = path.join(folder, 'src');
    const setupPath = path.join(folder, 'install', 'setup.bash');

    if (!fs.existsSync(srcPath) || !fs.statSync(srcPath).isDirectory()) {
        throw new Error(`Selected ROSSDL workspace does not contain src folder: ${srcPath}`)
    }
    if (!fs.existsSync(setupPath) || !fs.statSync(setupPath).isFile()) {
        throw new Error(`Selected ROSSDL workspace does not contain setup script: ${setupPath}`)
    }
}

async function runShellCommand(command: string, args: string[], cwd: string, label: string, outputChannel: OutputChannel): Promise<void> {
    outputChannel.appendLine('');
    outputChannel.appendLine(`==== ${label} ====`);
    outputChannel.appendLine(`cwd: ${cwd}`);
    outputChannel.appendLine(`command: ${command} ${args.join(' ')}`);
    outputChannel.appendLine('');

    await new Promise<void>((resolve, reject) => {
        const child = spawn(command, args, {
            cwd,
            env: process.env,
            stdio: 'pipe'
        });

        child.stdout?.on('data', (data: Buffer) => {
            outputChannel.append(data.toString());
        });

        child.stderr?.on('data', (data: Buffer) => {
            outputChannel.append(data.toString());
        });

        child.on('error', (error: Error) => {
            reject(new Error(`Failed tos start command: ${error.message}`));
        });

        child.on('close', (code: number) => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`Command exited with code ${code}`));
            }
        });
    });
}

/**
 * Converts a string (e.g., snake_case or kebab-case) into PascalCase/CamelCase.
 */
export function toCamelCase(str: string): string {
    if (!str) return '';
    const parts = str.split(/[_\-/]/);
    let result = '';
    for (const part of parts) {
        if (part.length > 0) {
            result += part.charAt(0).toUpperCase() + part.slice(1);
        }
    }
    return result;
}

/**
 * Converts a string (e.g., PascalCase or CamelCase) into snake_case.
 */
export function toSnakeCase(str: string): string {
    if (!str) return '';
    let s = str.replace(/(.)([A-Z])/g, '$1_$2').toLowerCase();
    s = s.replace(/[\s\-/]+/g, '_');
    s = s.replace(/_+/g, '_');
    if (s.startsWith('_')) {
        s = s.slice(1);
    }
    if (s.endsWith('_')) {
        s = s.slice(0, -1);
    }
    return s;
}

/**
 * Automatically prunes opposite-language source and runner files for a specific node
 * when switching between C++ and Python implementations to prevent duplicate/lingering nodes.
 */
export async function cleanOppositeLanguageFiles(
    srcGenUri: Uri,
    pkgName: string,
    node: { artifactName: string; nodeName: string },
    targetLanguage: 'cpp' | 'python'
): Promise<void> {
    const pkgUri = Uri.joinPath(srcGenUri, pkgName);
    if (targetLanguage === 'cpp') {
        // Node is being generated as C++. Clean up obsolete Python files for this node.
        const snakeNames = new Set([
            toSnakeCase(node.nodeName),
            toSnakeCase(node.artifactName)
        ]);
        for (const s of snakeNames) {
            if (!s) continue;
            const files = [
                `${pkgName}/${s}_wrapper.py`,
                `${pkgName}/${s}_runner.py`,
                `${pkgName}/${s}_logic.py`,
            ];
            for (const rel of files) {
                try {
                    await workspace.fs.delete(Uri.joinPath(pkgUri, rel));
                    console.log(`Cleaned up obsolete Python file: ${pkgName}/${rel}`);
                } catch {
                    // Ignore if not present
                }
            }
        }
        // If no other .py files remain in <pkgName>/<pkgName>, remove the python package folder
        try {
            const pyPkgDir = Uri.joinPath(pkgUri, pkgName);
            const entries = await workspace.fs.readDirectory(pyPkgDir);
            const hasOtherPy = entries.some(([name]) => name.endsWith('.py') && name !== '__init__.py');
            if (!hasOtherPy) {
                await workspace.fs.delete(pyPkgDir, { recursive: true, useTrash: false });
                console.log(`Cleaned up obsolete Python package folder: ${pkgName}/${pkgName}`);
            }
        } catch {
            // Ignore
        }
    } else if (targetLanguage === 'python') {
        // Node is being generated as Python. Clean up obsolete C++ files for this node.
        const camelNames = new Set([
            toCamelCase(node.artifactName),
            toCamelCase(node.nodeName)
        ]);
        for (const c of camelNames) {
            if (!c) continue;
            const files = [
                `include/${pkgName}/${c}Wrapper.hpp`,
                `include/${pkgName}/${c}Algorithm.hpp`,
                `src/${c}Wrapper.cpp`,
                `src/${c}Runner.cpp`,
            ];
            for (const rel of files) {
                try {
                    await workspace.fs.delete(Uri.joinPath(pkgUri, rel));
                    console.log(`Cleaned up obsolete C++ file: ${pkgName}/${rel}`);
                } catch {
                    // Ignore if not present
                }
            }
        }
        // If include/<pkgName> or src is empty, remove them
        try {
            const incPkgDir = Uri.joinPath(pkgUri, 'include', pkgName);
            const entries = await workspace.fs.readDirectory(incPkgDir);
            if (entries.length === 0) {
                await workspace.fs.delete(incPkgDir, { recursive: false, useTrash: false });
                const incDir = Uri.joinPath(pkgUri, 'include');
                const incEntries = await workspace.fs.readDirectory(incDir);
                if (incEntries.length === 0) {
                    await workspace.fs.delete(incDir, { recursive: false, useTrash: false });
                }
            }
        } catch {
            // Ignore
        }
        try {
            const srcDir = Uri.joinPath(pkgUri, 'src');
            const entries = await workspace.fs.readDirectory(srcDir);
            if (entries.length === 0) {
                await workspace.fs.delete(srcDir, { recursive: false, useTrash: false });
            }
        } catch {
            // Ignore
        }
    }
}

/**
 * Automatically prunes redundant build and setup files when switching between
 * pure Python (ament_python) and C++ / Hybrid (ament_cmake / ament_cmake_python) packages.
 */
export async function cleanRedundantBuildFiles(
    srcGenUri: Uri,
    pkgName: string,
    isCMakePackage: boolean
): Promise<void> {
    const pkgUri = Uri.joinPath(srcGenUri, pkgName);
    if (isCMakePackage) {
        // In C++ or Hybrid packages, build is driven by CMakeLists.txt.
        // Redundant Python setuptools files, pyproject.toml, and resource folder files cause
        // PEP 517 src-layout resolution errors in Pyright / VS Code and pollute CMake packages.
        const filesToDelete = [
            'setup.py',
            'setup.cfg',
            'pyproject.toml',
            `resource/${pkgName}`
        ];
        for (const rel of filesToDelete) {
            try {
                await workspace.fs.delete(Uri.joinPath(pkgUri, rel));
                console.log(`Cleaned up redundant file: ${pkgName}/${rel}`);
            } catch {
                // Ignore if not present
            }
        }
        // In CMake packages, delete the resource directory ONLY IF it is empty (preserving .puml)
        try {
            const resourceDir = Uri.joinPath(pkgUri, 'resource');
            const entries = await workspace.fs.readDirectory(resourceDir);
            if (entries.length === 0) {
                await workspace.fs.delete(resourceDir, { recursive: false, useTrash: false });
                console.log(`Cleaned up empty resource directory: ${pkgName}/resource`);
            }
        } catch {
            // Ignore
        }
    } else {
        // In pure Python packages, build is driven by setup.py / setup.cfg.
        // CMakeLists.txt and pyproject.toml are redundant.
        const filesToDelete = [
            'CMakeLists.txt',
            'pyproject.toml'
        ];
        for (const rel of filesToDelete) {
            try {
                await workspace.fs.delete(Uri.joinPath(pkgUri, rel));
                console.log(`Cleaned up redundant file: ${pkgName}/${rel}`);
            } catch {
                // Ignore if not present
            }
        }
    }
}

/**
 * Ensures that CMakeLists.txt in a package contains installation directives
 * for launch/ (and config/ if present) when launch files are generated.
 */
export async function ensureLaunchInstallInCMake(srcGenUri: Uri, pkgName: string): Promise<void> {
    const cmakeUri = Uri.joinPath(srcGenUri, pkgName, 'CMakeLists.txt');
    try {
        const cmakeBytes = await workspace.fs.readFile(cmakeUri);
        let cmakeContent = new TextDecoder().decode(cmakeBytes);

        // Check if launch install directive is already present
        const hasLaunchInstall = cmakeContent.includes('install(DIRECTORY launch') ||
                                 cmakeContent.includes('DIRECTORY launch') ||
                                 cmakeContent.includes('install(DIRECTORY\n  launch');

        if (!hasLaunchInstall && cmakeContent.includes('ament_package()')) {
            const launchInstallSnippet = `if(EXISTS "\${CMAKE_CURRENT_SOURCE_DIR}/launch")
  install(DIRECTORY launch
    DESTINATION share/\${PROJECT_NAME}
  )
endif()

if(EXISTS "\${CMAKE_CURRENT_SOURCE_DIR}/config")
  install(DIRECTORY config
    DESTINATION share/\${PROJECT_NAME}
  )
endif()

ament_package()`;

            cmakeContent = cmakeContent.replace('ament_package()', launchInstallSnippet);
            await workspace.fs.writeFile(cmakeUri, new TextEncoder().encode(cmakeContent));
            console.log(`Injected launch install directives into ${pkgName}/CMakeLists.txt`);
        }
    } catch {
        // CMakeLists.txt does not exist
    }
}

/**
 * Ensures that package.xml contains exec_depend for launch and launch_ros
 * when launch files are generated.
 */
export async function ensureLaunchDepsInPackageXml(srcGenUri: Uri, pkgName: string): Promise<void> {
    const pkgXmlUri = Uri.joinPath(srcGenUri, pkgName, 'package.xml');
    try {
        const pkgXmlBytes = await workspace.fs.readFile(pkgXmlUri);
        let pkgXmlContent = new TextDecoder().decode(pkgXmlBytes);

        if (!pkgXmlContent.includes('<exec_depend>launch</exec_depend>') && pkgXmlContent.includes('</package>')) {
            const launchDeps = `  <exec_depend>ament_index_python</exec_depend>
  <exec_depend>launch</exec_depend>
  <exec_depend>launch_ros</exec_depend>
</package>`;
            pkgXmlContent = pkgXmlContent.replace('</package>', launchDeps);
            await workspace.fs.writeFile(pkgXmlUri, new TextEncoder().encode(pkgXmlContent));
            console.log(`Injected launch dependencies into ${pkgName}/package.xml`);
        }
    } catch {
        // package.xml does not exist
    }
}