package de.fraunhofer.ipa.ros.lsp;

import java.io.PrintStream;
import java.util.ArrayList;
import java.util.List;

import org.eclipse.emf.ecore.EPackage;
import org.eclipse.glsp.server.launch.GLSPServerLauncher;
import org.eclipse.glsp.server.launch.SocketGLSPServerLauncher;
import org.eclipse.xtext.ide.server.IMultiRootWorkspaceConfigFactory;
import org.eclipse.xtext.ide.server.IProjectDescriptionFactory;
import org.eclipse.xtext.ide.server.ServerLauncher;
import org.eclipse.xtext.ide.server.ServerModule;
import org.eclipse.xtext.util.IFileSystemScanner;

import com.google.inject.AbstractModule;
import com.google.inject.Module;
import com.google.inject.util.Modules;

import de.fraunhofer.ipa.ros.glsp.RosGlspModule;
import de.fraunhofer.ipa.ros.ide.BasicsIdeSetup;
import de.fraunhofer.ipa.ros.ide.RosIdeSetup;
import de.fraunhofer.ipa.ros1.ide.Ros1IdeSetup;
import de.fraunhofer.ipa.ros2.ide.Ros2IdeSetup;
import de.fraunhofer.ipa.rossystem.ide.RosSystemIdeSetup;
import ros.RosPackage;
import system.RossystemPackage;

public class RosLanguageServerLauncher {

    public static final String DEFAULT_GLSP_HOST = "127.0.0.1";
    public static final int DEFAULT_GLSP_PORT = 5008;

    public static void registerMetamodelsAndLanguages() {
        if (!EPackage.Registry.INSTANCE.containsKey("http://www.ipa.fraunhofer.de/ros")) {
            EPackage.Registry.INSTANCE.put("http://www.ipa.fraunhofer.de/ros", RosPackage.eINSTANCE);
        }
        if (!EPackage.Registry.INSTANCE.containsKey("http://www.ipa.fraunhofer.de/rossystem")) {
            EPackage.Registry.INSTANCE.put("http://www.ipa.fraunhofer.de/rossystem", RossystemPackage.eINSTANCE);
        }

        new BasicsIdeSetup().createInjectorAndDoEMFRegistration();
        new RosIdeSetup().createInjectorAndDoEMFRegistration();
        new Ros1IdeSetup().createInjectorAndDoEMFRegistration();
        new Ros2IdeSetup().createInjectorAndDoEMFRegistration();
        new RosSystemIdeSetup().createInjectorAndDoEMFRegistration();
    }

    public static SocketGLSPServerLauncher createGlspServerLauncher() {
        org.eclipse.glsp.server.di.ServerModule glspServerModule = new org.eclipse.glsp.server.di.ServerModule()
                .configureDiagramModule(new RosGlspModule());
        return new SocketGLSPServerLauncher(glspServerModule);
    }

    public static void main(String[] args) {
        registerMetamodelsAndLanguages();

        boolean glspStandalone = false;
        String glspHost = System.getProperty("ros.glsp.host", DEFAULT_GLSP_HOST);
        int glspPort = -1;

        String propPort = System.getProperty("ros.glsp.port", System.getenv("ROS_GLSP_PORT"));
        if (propPort != null && !propPort.isBlank()) {
            try {
                glspPort = Integer.parseInt(propPort.trim());
            } catch (NumberFormatException e) {
                System.err.println("[GLSP-Server] Invalid ros.glsp.port: " + propPort);
            }
        }

        List<String> lspArgs = new ArrayList<>();
        if (args != null) {
            for (int i = 0; i < args.length; i++) {
                String arg = args[i];
                if ("--glsp".equals(arg)) {
                    glspStandalone = true;
                } else if ("--port".equals(arg) && i + 1 < args.length) {
                    try {
                        glspPort = Integer.parseInt(args[++i]);
                    } catch (NumberFormatException e) {
                        System.err.println("[GLSP-Server] Invalid --port argument: " + args[i]);
                    }
                } else if (arg.startsWith("--port=")) {
                    try {
                        glspPort = Integer.parseInt(arg.substring("--port=".length()));
                    } catch (NumberFormatException e) {
                        System.err.println("[GLSP-Server] Invalid --port argument: " + arg);
                    }
                } else if ("--host".equals(arg) && i + 1 < args.length) {
                    glspHost = args[++i];
                } else if (arg.startsWith("--host=")) {
                    glspHost = arg.substring("--host=".length());
                } else {
                    lspArgs.add(arg);
                }
            }
        }

        if (glspStandalone) {
            int targetPort = glspPort > 0 ? glspPort : DEFAULT_GLSP_PORT;
            GLSPServerLauncher launcher = createGlspServerLauncher();
            System.err.println("[GLSP-Server] Starting standalone GLSP server on " + glspHost + ":" + targetPort);
            launcher.start(glspHost, targetPort);
            return;
        }

        if (glspPort > 0) {
            final String host = glspHost;
            final int port = glspPort;
            SocketGLSPServerLauncher glspLauncher = createGlspServerLauncher();
            PrintStream originalOut = System.out;
            try {
                System.setOut(System.err);
                glspLauncher.asyncRun(host, port);
            } catch (Exception e) {
                System.err.println("[GLSP-Server] Failed to start co-hosted GLSP server on " + host + ":" + port + " - " + e.getMessage());
            } finally {
                System.setOut(originalOut);
            }
        }

        Module serverModule = Modules.override(new ServerModule()).with(new AbstractModule() {
            @Override
            protected void configure() {
                bind(IMultiRootWorkspaceConfigFactory.class).to(RosMultiRootWorkspaceConfigFactory.class);
                bind(IProjectDescriptionFactory.class).to(RosProjectDescriptionFactory.class);
                bind(IFileSystemScanner.class).to(RosFileSystemScanner.class);
            }
        });

        ServerLauncher.launch("RosTooling", lspArgs.toArray(new String[0]), serverModule);
    }
}
