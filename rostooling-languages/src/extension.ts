'use_strict';

import * as path from 'path';

import { window, workspace, ExtensionContext, commands, Uri } from 'vscode';
import { LanguageClient, LanguageClientOptions, ServerOptions, Trace, ErrorHandlerResult, ErrorAction, Message, CloseHandlerResult, CloseAction } from 'vscode-languageclient/node';

let lc: LanguageClient;

export async function activate(context: ExtensionContext) {
    const outputChannel = window.createOutputChannel('ROS LSP');
    outputChannel.show(true);
    outputChannel.appendLine('Initializing ROS LSP client');

    // The server is a locally installed in build/libs/
    const extensionVersion = context.extension.packageJSON.version;
    const jarPath = context.asAbsolutePath(path.join('server', `rostooling_extension-${extensionVersion}.jar`));

    const serverOptions: ServerOptions = {
        run : {
            command: 'java',
            args: [
                '--add-opens=java.base/java.lang=ALL-UNNAMED',
                '--add-opens=java.base/java.util=ALL-UNNAMED',
                '-jar', jarPath                
            ]
        },
        debug: {
            command: 'java',
            args: [
                '--add-opens=java.base/java.lang=ALL-UNNAMED',
                '--add-opens=java.base/java.util=ALL-UNNAMED',
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

    const generateCodeCommand = commands.registerCommand('rossystem.triggerCodeGeneration', async () => {
        const activeEditor = window.activeTextEditor;
        if (!activeEditor || !lc) {
            window.showErrorMessage('No active ROS editor or LSP not ready');
            return;
        }
        
        try {
            const targetUri = activeEditor.document.uri.toString();
            console.log('Sending execute Command to server...')
            const result = await lc.sendRequest<{ files?: Record<string, string>, error?: string }>('workspace/executeCommand', {
                command: 'rossystem.generateCode',
                arguments: [targetUri]
            });
            
            // Safe access
            const files = result?.files || {};
            const count = Object.keys(files).length;
            
            if (result?.error) {
                window.showErrorMessage(`Generation error: ${result.error}`);
            } else if (count > 0) {
                window.showInformationMessage(`Generated ${count} file(s)`);

                const workspaceFolder = workspace.getWorkspaceFolder(activeEditor.document.uri);
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
                window.showInformationMessage(`Successfully generated and wrote ${count} file(s) to src-gen/`)
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
}

export function deactivate(): Thenable<void> | undefined {
    if(!lc) {
        return undefined;
    }
    return lc.stop();
}

// test line