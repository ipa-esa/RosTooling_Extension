package de.fraunhofer.ipa.ros.lsp;

import java.io.File;
import java.util.Set;

import org.eclipse.emf.common.util.URI;
import org.eclipse.xtext.util.IAcceptor;
import org.eclipse.xtext.util.IFileSystemScanner.JavaIoFileSystemScanner;

/**
 * Custom filesystem scanner for RosTooling Language Server.
 * Excludes heavy build and metadata directories from recursive workspace indexing
 * to dramatically speed up server startup in ROS workspaces.
 */
public class RosFileSystemScanner extends JavaIoFileSystemScanner {

    private static final Set<String> EXCLUDED_DIRECTORIES = Set.of(
        ".git",
        ".gradle",
        ".vscode",
        ".vscode-test",
        "build",
        "install",
        "log",
        ".colcon",
        "node_modules",
        "target",
        "bin",
        ".settings"
    );

    @Override
    public void scanRec(File file, IAcceptor<URI> acceptor) {
        if (file != null && file.isDirectory() && EXCLUDED_DIRECTORIES.contains(file.getName())) {
            return;
        }
        super.scanRec(file, acceptor);
    }
}
