package de.fraunhofer.ipa.ros.lsp;

import java.util.ArrayList;
import java.util.List;

import org.eclipse.xtext.ide.server.DefaultProjectDescriptionFactory;
import org.eclipse.xtext.resource.impl.ProjectDescription;
import org.eclipse.xtext.workspace.IProjectConfig;
import org.eclipse.xtext.workspace.IWorkspaceConfig;

public class RosProjectDescriptionFactory extends DefaultProjectDescriptionFactory {

    @Override
    public ProjectDescription getProjectDescription(IProjectConfig config) {
        ProjectDescription description = super.getProjectDescription(config);

        if (config == null || config.getName() == null) {
            return description;
        }

        String currentName = config.getName();

        // Catalogue libraries themselves have no dependencies on user projects or anything else
        if (RosMultiRootWorkspaceConfigFactory.CATALOGUE_PROJECT_NAME.equals(currentName)
                || currentName.startsWith("RosCatalogueCustom_")) {
            return description;
        }

        List<String> deps = new ArrayList<>(description.getDependencies());

        // Always add RosCatalogueLibrary as a dependency if available
        if (!deps.contains(RosMultiRootWorkspaceConfigFactory.CATALOGUE_PROJECT_NAME)) {
            deps.add(RosMultiRootWorkspaceConfigFactory.CATALOGUE_PROJECT_NAME);
        }

        // Add any other projects in the workspace without introducing cycles
        IWorkspaceConfig wsConfig = config.getWorkspaceConfig();
        if (wsConfig != null) {
            for (IProjectConfig other : wsConfig.getProjects()) {
                String otherName = other.getName();
                if (otherName == null || otherName.equals(currentName) || "__unknown_project".equals(otherName)) {
                    continue;
                }

                // Custom catalogues are external libraries with no dependencies, always safe to depend on
                if (otherName.startsWith("RosCatalogueCustom_")) {
                    if (!deps.contains(otherName)) {
                        deps.add(otherName);
                    }
                } else if (!"__unknown_project".equals(currentName)
                        && !RosMultiRootWorkspaceConfigFactory.CATALOGUE_PROJECT_NAME.equals(otherName)) {
                    // Sibling user workspace projects: enforce strict DAG ordering by name to prevent mutual cycles
                    // (Note: __unknown_project must never depend on user projects)
                    if (otherName.compareTo(currentName) < 0 && !deps.contains(otherName)) {
                        deps.add(otherName);
                    }
                }
            }
        }

        description.setDependencies(deps);
        return description;
    }
}
