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

        // If this is the catalogue library itself, it has no dependencies on user projects
        if (RosMultiRootWorkspaceConfigFactory.CATALOGUE_PROJECT_NAME.equals(config.getName())
                || (config.getName() != null && config.getName().startsWith("RosCatalogueCustom_"))) {
            return description;
        }

        List<String> deps = new ArrayList<>(description.getDependencies());

        // Always add RosCatalogueLibrary as a dependency if available
        if (!deps.contains(RosMultiRootWorkspaceConfigFactory.CATALOGUE_PROJECT_NAME)) {
            deps.add(RosMultiRootWorkspaceConfigFactory.CATALOGUE_PROJECT_NAME);
        }

        // Add any other projects in the workspace (including custom catalogue folders and sibling user projects)
        IWorkspaceConfig wsConfig = config.getWorkspaceConfig();
        if (wsConfig != null) {
            for (IProjectConfig other : wsConfig.getProjects()) {
                String otherName = other.getName();
                if (otherName != null && !otherName.equals(config.getName()) && !deps.contains(otherName)) {
                    deps.add(otherName);
                }
            }
        }

        description.setDependencies(deps);
        return description;
    }
}
