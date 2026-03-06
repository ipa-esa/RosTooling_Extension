package de.fraunhofer.ipa.ros.lsp;

import org.eclipse.emf.ecore.EPackage;
import org.eclipse.xtext.ide.server.ServerLauncher;

import ros.RosPackage;
import system.RossystemPackage;

public class RosLanguageServerLauncher {
    public static void main(String[] args) {
        
        // 1. Manually register your Ecore metamodels
        if (!EPackage.Registry.INSTANCE.containsKey("http://www.ipa.fraunhofer.de/ros")) {
            EPackage.Registry.INSTANCE.put("http://www.ipa.fraunhofer.de/ros", RosPackage.eINSTANCE);
        }
        
        // Register the others if they have distinct namespaces:
        // EPackage.Registry.INSTANCE.put("http://www.ipa.fraunhofer.de/ros1", Ros1Package.eINSTANCE);
        // EPackage.Registry.INSTANCE.put("http://www.ipa.fraunhofer.de/ros2", Ros2Package.eINSTANCE);
        EPackage.Registry.INSTANCE.put("http://www.ipa.fraunhofer.de/rossystem", RossystemPackage.eINSTANCE);

        // 2. Start the standard Xtext Language Server
        ServerLauncher.main(args);
    }
}
