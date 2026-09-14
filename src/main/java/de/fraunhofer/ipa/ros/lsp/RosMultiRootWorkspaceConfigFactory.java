package de.fraunhofer.ipa.ros.lsp;

import java.io.File;
import java.nio.file.Files;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.eclipse.emf.common.util.URI;
import org.eclipse.lsp4j.WorkspaceFolder;
import org.eclipse.xtext.ide.server.MultiRootWorkspaceConfigFactory;
import org.eclipse.xtext.workspace.FileProjectConfig;
import org.eclipse.xtext.workspace.IWorkspaceConfig;
import org.eclipse.xtext.workspace.WorkspaceConfig;

public class RosMultiRootWorkspaceConfigFactory extends MultiRootWorkspaceConfigFactory {

    public static final String CATALOGUE_PROJECT_NAME = "RosCatalogueLibrary";

    @Override
    public IWorkspaceConfig getWorkspaceConfig(List<WorkspaceFolder> folders) {
        WorkspaceConfig config = new WorkspaceConfig();
        Set<String> uniqueNames = new HashSet<>();

        if (folders != null) {
            for (WorkspaceFolder folder : folders) {
                addProjectsForWorkspaceFolder(config, folder, uniqueNames);
            }
        }

        // Register central catalogue library
        registerCatalogueProjects(config, uniqueNames);

        return config;
    }

    @Override
    protected void addProjectsForWorkspaceFolder(WorkspaceConfig config, WorkspaceFolder folder, Set<String> uniqueNames) {
        if (folder != null && folder.getUri() != null) {
            URI projectUri = getUriExtensions().toUri(folder.getUri());
            String projectName = getUniqueProjectName(folder.getName(), uniqueNames);
            FileProjectConfig project = new FileProjectConfig(projectUri, projectName, config);
            project.addSourceFolder(".");
            config.addProject(project);
        }
    }

    protected void registerCatalogueProjects(WorkspaceConfig config, Set<String> uniqueNames) {
        String cataloguePath = System.getProperty("rostooling.catalogue.path");
        if (cataloguePath == null || cataloguePath.trim().isEmpty()) {
            cataloguePath = System.getProperty("user.home") + File.separator + ".rostooling" + File.separator + "catalogue_repos";
        }

        File catalogueDir = new File(cataloguePath);
        if (catalogueDir.exists() && catalogueDir.isDirectory()) {
            URI catalogueUri = getUriExtensions().toUri(catalogueDir.toURI().toString());
            uniqueNames.add(CATALOGUE_PROJECT_NAME);
            FileProjectConfig catProject = new FileProjectConfig(catalogueUri, CATALOGUE_PROJECT_NAME, config);
            catProject.addSourceFolder(".");
            config.addProject(catProject);

            // Also check for custom folders in catalogue_config.json if present
            File configFile = new File(catalogueDir, "catalogue_config.json");
            if (configFile.exists() && configFile.isFile()) {
                try {
                    String json = Files.readString(configFile.toPath());
                    Pattern pattern = Pattern.compile("\"path\"\\s*:\\s*\"([^\"]+)\"");
                    Matcher matcher = pattern.matcher(json);
                    while (matcher.find()) {
                        String customPath = matcher.group(1);
                        File customDir = new File(customPath);
                        if (customDir.exists() && customDir.isDirectory()) {
                            String customName = getUniqueProjectName("RosCatalogueCustom_" + customDir.getName(), uniqueNames);
                            URI customUri = getUriExtensions().toUri(customDir.toURI().toString());
                            FileProjectConfig customProject = new FileProjectConfig(customUri, customName, config);
                            customProject.addSourceFolder(".");
                            config.addProject(customProject);
                        }
                    }
                } catch (Exception e) {
                    // Ignore config parse errors
                }
            }
        }
    }
}
