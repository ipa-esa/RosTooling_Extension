package de.example.extprobe;

import de.fraunhofer.ipa.ros.plugin.spi.BlockDescriptor;
import de.fraunhofer.ipa.ros.plugin.spi.HookLocation;
import de.fraunhofer.ipa.ros.plugin.spi.LoaderDescriptor;
import de.fraunhofer.ipa.ros.plugin.spi.MergeStrategy;
import de.fraunhofer.ipa.ros.plugin.spi.PackageBuild;
import de.fraunhofer.ipa.ros.plugin.spi.PackageGenerationContext;
import de.fraunhofer.ipa.ros.plugin.spi.PluginToolDescriptor;
import de.fraunhofer.ipa.ros.plugin.spi.RosToolingPlugin;
import de.fraunhofer.ipa.ros.plugin.spi.SchemaHints;
import de.fraunhofer.ipa.ros.plugin.spi.SystemGenerationContext;
import de.fraunhofer.ipa.ros.plugin.spi.ToolResult;
import de.fraunhofer.ipa.ros.plugin.spi.ValidationContext;
import java.util.ArrayList;
import java.util.EnumSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.eclipse.emf.ecore.EAttribute;
import org.eclipse.emf.ecore.EClass;
import org.eclipse.emf.ecore.EObject;
import org.eclipse.emf.ecore.EPackage;
import org.eclipse.emf.ecore.EStructuralFeature;
import org.eclipse.emf.ecore.EcoreFactory;
import org.eclipse.emf.ecore.EcorePackage;
import ros.Artifact;
import ros.Extensible;
import ros.Node;
import ros.Parameter;
import ros.Plugin;

/**
 * Standalone external Phase 2 test plugin packaged outside core depending only on the public SPI.
 */
public final class ExternalProbePlugin implements RosToolingPlugin {

    public static final String ID = "de.example.extprobe";

    private static final EClass PROBE_SCHEMA = createSchema();
    private static final BlockDescriptor PROBE_BLOCK = new BlockDescriptor(
            "probe",
            PROBE_SCHEMA,
            EnumSet.of(HookLocation.SYSTEM, HookLocation.ROS_NODE, HookLocation.NODE),
            Map.of(
                    "profile", MergeStrategy.INSTANCE_OVERRIDES_TYPE,
                    "interval_ms", MergeStrategy.INSTANCE_OVERRIDES_TYPE,
                    "enabled", MergeStrategy.INSTANCE_OVERRIDES_TYPE),
            "External probe configuration block (`@probe`)");

    private static EClass createSchema() {
        EcoreFactory ef = EcoreFactory.eINSTANCE;
        EPackage ePkg = ef.createEPackage();
        ePkg.setName("extprobe");
        ePkg.setNsPrefix("extprobe");
        ePkg.setNsURI("http://example.org/rostooling/extprobe");

        EClass cls = ef.createEClass();
        cls.setName("ProbeBlock");
        SchemaHints.set(cls, SchemaHints.HELP, "Settings of the external probe.");

        EAttribute profileAttr = ef.createEAttribute();
        profileAttr.setName("profile");
        profileAttr.setEType(EcorePackage.Literals.ESTRING);
        profileAttr.setLowerBound(1);
        SchemaHints.set(profileAttr, SchemaHints.LABEL, "Profile");
        SchemaHints.set(profileAttr, SchemaHints.HELP, "Which probe profile to generate.");
        SchemaHints.set(profileAttr, SchemaHints.ORDER, "1");
        SchemaHints.set(profileAttr, SchemaHints.CHOICES, "fast, thorough");
        cls.getEStructuralFeatures().add(profileAttr);

        EAttribute intervalAttr = ef.createEAttribute();
        intervalAttr.setName("interval_ms");
        intervalAttr.setEType(EcorePackage.Literals.EINT);
        SchemaHints.set(intervalAttr, SchemaHints.LABEL, "Interval (ms)");
        SchemaHints.set(intervalAttr, SchemaHints.ORDER, "2");
        cls.getEStructuralFeatures().add(intervalAttr);

        EAttribute enabledAttr = ef.createEAttribute();
        enabledAttr.setName("enabled");
        enabledAttr.setEType(EcorePackage.Literals.EBOOLEAN);
        enabledAttr.setDefaultValueLiteral("true");
        cls.getEStructuralFeatures().add(enabledAttr);

        ePkg.getEClassifiers().add(cls);
        return cls;
    }

    @Override
    public String id() {
        return ID;
    }

    @Override
    public String documentationMarkdown() {
        return """
                # External Probe Plugin (`de.example.extprobe`)

                Provides the `@probe:` extension block for `.ros2` and `.rossystem` models.
                Exposes `de_example_extprobe__inspect_probe` and schema tool
                `de_example_extprobe__set_probe`.
                """;
    }

    @Override
    public List<BlockDescriptor> blocks() {
        return List.of(PROBE_BLOCK);
    }

    @Override
    public List<LoaderDescriptor> loaders() {
        return List.of(new LoaderDescriptor("probe", "Test loader: writes one file per plugin"));
    }

    @Override
    public void validate(final ValidationContext context) {
        if (context.typedBlock() == null) {
            return;
        }
        EStructuralFeature intervalFeat = PROBE_SCHEMA.getEStructuralFeature("interval_ms");
        Object rawInterval = context.typedBlock().eGet(intervalFeat);
        if (rawInterval instanceof Integer val && val <= 0) {
            context.error(
                    "probe interval_ms must be > 0, got " + val,
                    context.block(),
                    null,
                    "EXTPROBE_INVALID_INTERVAL");
        }
    }

    @Override
    public void generatePackage(final PackageGenerationContext context) {
        String profile = null;
        for (Artifact art : context.packageModel().getArtifact()) {
            if (art.getNode() != null) {
                EObject nodeTyped = context.typedBlock(art.getNode(), "probe");
                if (nodeTyped != null && profile == null) {
                    profile = stringFeature(nodeTyped, "profile");
                }
            }
        }
        for (Plugin pl : context.loaderPlugins()) {
            context.writeFile("plugins/" + context.pluginFolder() + "/loads_" + sanitizeFileToken(pl.getName()) + ".txt",
                    pl.getName() + "\n");
        }
        if (profile == null) {
            return;
        }
        String safeProfile = sanitizeFileToken(profile);
        String pf = context.pluginFolder();
        String stateRel = "plugins/" + pf + "/probe_state.txt";
        var prevState = context.readOwnedFile(stateRel);
        if (prevState.isPresent()) {
            String prevProfile = prevState.get().trim();
            if (!prevProfile.isEmpty() && !prevProfile.equals(profile)) {
                String oldSnapRel = "plugins/" + pf + "/snapshot_" + sanitizeFileToken(prevProfile) + ".txt";
                var oldContent = context.readOwnedFile(oldSnapRel);
                context.addNotice("rotated probe profile from '" + prevProfile + "' (had_old="
                        + oldContent.isPresent() + ") to '" + profile + "'");
                if (oldContent.isPresent()) {
                    context.deleteStaleFile(oldSnapRel);
                }
            } else if (!prevProfile.isEmpty()) {
                context.addNotice("regenerated probe profile '" + prevProfile + "'");
            }
        }
        String content = "profile=" + profile
                + "\ndistro=" + context.rosDistro()
                + "\ncxx_standard=" + context.ros2Distro().cxxStandard() + "\n";
        context.writeFile("plugins/de.example.extprobe/probe_" + safeProfile + ".txt", content);
        context.writeFile("plugins/" + pf + "/snapshot_" + safeProfile + ".txt", content);
        context.writeFile(stateRel, profile + "\n");

        PackageBuild pb = context.packageBuild();
        pb.addDepend("std_msgs");
        pb.addFindPackage("std_msgs");
        pb.addInstallDirectory("plugins/de.example.extprobe", "share/${PROJECT_NAME}/extprobe", false);
        context.addNotice("probe profile '" + profile + "' generated for " + context.packageModel().getName());
    }

    @Override
    public void generateSystem(final SystemGenerationContext context) {
        EObject sysTyped = context.systemTypedBlock("probe");
        List<String> nodeLines = new ArrayList<>();
        String profile = sysTyped != null ? stringFeature(sysTyped, "profile") : null;

        for (Extensible rosNode : context.rosNodes()) {
            String rnName = eStringFeature(rosNode, "name");
            EObject mergedTyped = context.rosNodeTypedBlock(rosNode, "probe");
            String rnProfile = mergedTyped != null ? stringFeature(mergedTyped, "profile") : null;
            if (profile == null && rnProfile != null) {
                profile = rnProfile;
            }
            List<String> paramNames = new ArrayList<>();
            Object rawParams = readFeature(rosNode, "rosparameters");
            if (rawParams instanceof List<?> list) {
                for (Object item : list) {
                    if (item instanceof EObject paramObj) {
                        String pName = eStringFeature(paramObj, "name");
                        if (pName != null) {
                            paramNames.add(pName);
                        }
                    }
                }
            }
            nodeLines.add("  - name: " + rnName
                    + (rnProfile != null ? " (profile=" + rnProfile + ")" : "")
                    + " params=" + paramNames);
        }

        if (profile == null && nodeLines.isEmpty()) {
            return;
        }
        if (profile == null) {
            return;
        }

        List<String> resolvedPkgNames = new ArrayList<>();
        for (ros.Package pkg : context.resolvedPackages()) {
            resolvedPkgNames.add(pkg.getName());
        }
        List<String> resolvedNodeSummary = new ArrayList<>();
        for (Node n : context.resolvedNodes()) {
            List<String> defParams = new ArrayList<>();
            for (Parameter p : n.getParameter()) {
                defParams.add(p.getName());
            }
            resolvedNodeSummary.add(n.getName() + defParams);
        }

        String yaml = "profile: " + profile + "\n"
                + "distro: " + context.rosDistro() + "\n"
                + "resolved_packages: " + resolvedPkgNames + "\n"
                + "resolved_nodes: " + resolvedNodeSummary + "\n"
                + "ros_nodes:\n" + String.join("\n", nodeLines) + "\n";

        String pf = context.pluginFolder();
        var prevSysState = context.readOwnedFile("plugins/" + pf + "/system_state.txt");
        if (prevSysState.isPresent()) {
            context.addNotice("prev_system_profile=" + prevSysState.get().trim());
        }
        context.writeFile("plugins/" + pf + "/system_state.txt", profile + "\n");
        context.writeFile("config/" + pf + "/system_probe.yaml", yaml);
        String launchPy = "from launch import LaunchDescription\n\n"
                + "def generate_launch_description():\n"
                + "    return LaunchDescription()\n";
        String launchRel = "launch/" + pf + "/probe.launch.py";
        context.writeFile(launchRel, launchPy);
        context.addLaunchInclude(
                launchRel,
                Map.of("probe_profile", SystemGenerationContext.LaunchArgumentValue.literal(profile)));
        context.addNotice("system probe '" + profile + "' generated");
    }

    @Override
    public List<PluginToolDescriptor> tools() {
        Map<String, Object> schema = new LinkedHashMap<>();
        schema.put("type", "object");
        schema.put("properties", Map.of(
                "filePath", Map.of("type", "string", "description", "Target model path"),
                "label", Map.of("type", "string", "description", "Optional probe label")));
        schema.put("required", List.of("filePath"));

        return List.of(new PluginToolDescriptor(
                "inspect_probe",
                "Inspect external probe plugin status for a model",
                schema,
                ctx -> ToolResult.ok("External probe inspected", Map.of(
                        "pluginId", ID,
                        "modelPath", ctx.modelPath() != null ? ctx.modelPath() : "",
                        "label", ctx.argString("label") != null ? ctx.argString("label") : "default"))));
    }

    private static String stringFeature(final EObject obj, final String featureName) {
        if (obj == null) {
            return null;
        }
        EStructuralFeature feat = obj.eClass().getEStructuralFeature(featureName);
        if (feat == null) {
            return null;
        }
        Object val = obj.eGet(feat);
        return val != null ? String.valueOf(val) : null;
    }

    private static Object readFeature(final EObject obj, final String featureName) {
        if (obj == null) {
            return null;
        }
        EStructuralFeature feat = obj.eClass().getEStructuralFeature(featureName);
        return feat != null ? obj.eGet(feat) : null;
    }

    private static String eStringFeature(final EObject obj, final String featureName) {
        Object val = readFeature(obj, featureName);
        return val != null ? String.valueOf(val) : null;
    }

    private static String sanitizeFileToken(final String raw) {
        return raw.replaceAll("[^A-Za-z0-9_-]", "_");
    }
}
