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

function checkJavaVersion(javaExecutable:string): Promise<boolean> {
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
    const isJavaValid = await checkJavaVersion(javaExecutable);
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
    outputChannel.appendLine("Java version is valid");

    const storageDir = context.globalStorageUri
        ? path.join(context.globalStorageUri.fsPath, 'catalogue_repos')
        : path.join(os.homedir(), '.rostooling', 'catalogue_repos');
    const catalogueManager = RosCatalogueManager.getInstance(storageDir);
    const cataloguePath = catalogueManager.getStorageDir();
    outputChannel.appendLine(`Catalogue storage path: ${cataloguePath}`);

    const serverOptions: ServerOptions = {
        run : {
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
        { scheme: 'file', language: 'ros'},
        { scheme: 'file', language: 'ros1'},
        { scheme: 'file', language: 'ros2'},
        { scheme: 'file', language: 'rossystem'},
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
                return{
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

    try {
        await lc.start();
        outputChannel.appendLine('Rostooling LSP Server started successfully');
    } catch (error) {
        outputChannel.appendLine(`Failed to start server: ${error}`);
    }

    const generateCodeCommand = commands.registerCommand('rossystem.triggerCodeGeneration', async (uri?: Uri) => {
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
            console.log('Sending execute Command to server...');
            const result = await lc.sendRequest<{ files?: Record<string, string>, error?: string }>('workspace/executeCommand', {
                command: 'rossystem.generateCode',
                arguments: [targetUriStr]
            });
            
            // Safe access
            const files = result?.files || {};
            const count = Object.keys(files).length;
            
            if (result?.error) {
                window.showErrorMessage(`Generation error: ${result.error}`);
            } else if (count > 0) {
                window.showInformationMessage(`Generated ${count} file(s)`);

                const workspaceFolder = workspace.getWorkspaceFolder(targetUri);
                if (!workspaceFolder) {
                    window.showErrorMessage('Current file is not inside workspace folder. Cannot create src-gen');
                    return;
                }

                const srcGenUri = Uri.joinPath(workspaceFolder.uri, 'src-gen');

                for (const [rawPath, content] of Object.entries(files)) {
                    const cleanPath = rawPath.replace(/^DEFAULT_OUTPUT\/?/, '');
                    const filePath = Uri.joinPath(srcGenUri, cleanPath);
                    const encoder = new TextEncoder();
                    await workspace.fs.writeFile(filePath, encoder.encode(content));
                }
                window.showInformationMessage(`Successfully generated and wrote ${count} file(s) to src-gen/`);
            } else {
                window.showInformationMessage('No files generated');
            }
            
            console.log('Full result:', result);
        } catch (error) {
            window.showErrorMessage(`Command failed: ${error}`);
            console.error('Command failed:', error);
        }
    });
    context.subscriptions.push(generateCodeCommand);

    const generateWrappersCommand = commands.registerCommand('ros2.generateWrappers', async (uri?: Uri, targetNodes?: string[], langChoice?: string) => {
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

        // 1. Language prompt if not provided
        let language = langChoice;
        if (!language) {
            const nodeLabel = targetNodes && targetNodes.length === 1 ? `'${targetNodes[0]}'` : 'the selected node(s)';
            const picked = await window.showQuickPick([
                { label: '$(file-code) C++', description: 'Generate C++ wrapper, runner, and pure algorithm template', value: 'cpp' },
                { label: '$(symbol-keyword) Python', description: 'Generate Python wrapper, runner, and pure logic template', value: 'python' },
                { label: '$(layers) Both (C++ & Python)', description: 'Generate both C++ and Python node wrappers', value: 'both' }
            ], {
                placeHolder: `Select implementation language for ${nodeLabel}`
            });
            if (!picked) return;
            language = picked.value;
        }

        // 2. Scan workspace src-gen to find existing files in this package for hybrid package support
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

        const hostDistro = process.env.ROS_DISTRO || 'humble';

        try {
            const result = await lc.sendRequest<{ files?: Record<string, string>, error?: string }>('workspace/executeCommand', {
                command: 'ros2.generateWrappers',
                arguments: [
                    targetUriStr,
                    targetNodes || [],
                    language,
                    hostDistro,
                    existingFiles
                ]
            });

            const files = result?.files || {};
            const count = Object.keys(files).length;

            if (result?.error) {
                window.showErrorMessage(`Generation error: ${result.error}`);
            } else if (count > 0) {
                const srcGenUri = Uri.joinPath(workspaceFolder.uri, 'src-gen');

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
    context.subscriptions.push(generateWrappersCommand);
    
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

    const openVisualStudioCmd = commands.registerCommand('rostooling.openVisualStudio', async (uri?: Uri) => {
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
    context.subscriptions.push(openVisualStudioCmd);

    const rossdlCommand = commands.registerCommand('rossdl.buildPackage', async () => {
        try {
            await runRossdlWorkflow(outputChannel);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            outputChannel.appendLine(`[ROSSDL error] ${message}`);
            outputChannel.show(true)
            window.showErrorMessage(message)
        }
    });
    context.subscriptions.push(rossdlCommand);
}

export function deactivate(): Thenable<void> | undefined {
    if(!lc) {
        return undefined;
    }
    return lc.stop();
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