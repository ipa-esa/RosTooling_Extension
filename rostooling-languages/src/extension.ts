'use_strict';

import * as path from 'path';

import { window, workspace, ExtensionContext } from 'vscode';
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
}

export function deactivate(): Thenable<void> | undefined {
    if(!lc) {
        return undefined;
    }
    return lc.stop();
}

// test line