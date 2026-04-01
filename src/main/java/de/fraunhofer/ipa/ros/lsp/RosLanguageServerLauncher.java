package de.fraunhofer.ipa.ros.lsp;

import org.eclipse.emf.ecore.EPackage;
import org.eclipse.xtext.ide.server.ServerLauncher;
import org.eclipse.xtext.ide.server.ServerModule;
import de.fraunhofer.ipa.ros.ide.BasicsIdeSetup;
import de.fraunhofer.ipa.ros.ide.RosIdeSetup;
import de.fraunhofer.ipa.ros1.ide.Ros1IdeSetup;
import de.fraunhofer.ipa.ros2.ide.Ros2IdeSetup;
import de.fraunhofer.ipa.rossystem.ide.RosSystemIdeSetup;

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

        new BasicsIdeSetup().createInjectorAndDoEMFRegistration();
        new RosIdeSetup().createInjectorAndDoEMFRegistration();
        new Ros1IdeSetup().createInjectorAndDoEMFRegistration();
        new Ros2IdeSetup().createInjectorAndDoEMFRegistration();
        new RosSystemIdeSetup().createInjectorAndDoEMFRegistration();
        
        ServerLauncher.launch("RosTooling", args, new ServerModule());
    }
}
