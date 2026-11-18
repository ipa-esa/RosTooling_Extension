package de.example.extprobe;

import de.fraunhofer.ipa.ros.plugin.spi.BlockDescriptor;
import de.fraunhofer.ipa.ros.plugin.spi.HookLocation;
import de.fraunhofer.ipa.ros.plugin.spi.PackageBuild;
import de.fraunhofer.ipa.ros.plugin.spi.PackageGenerationContext;
import de.fraunhofer.ipa.ros.plugin.spi.RosToolingPlugin;
import de.fraunhofer.ipa.ros.plugin.spi.ValidationContext;
import java.util.EnumSet;
import java.util.List;
import java.util.Map;
import org.eclipse.emf.ecore.EAttribute;
import org.eclipse.emf.ecore.EClass;
import org.eclipse.emf.ecore.EPackage;
import org.eclipse.emf.ecore.EcoreFactory;
import org.eclipse.emf.ecore.EcorePackage;
import ros.Artifact;

/**
 * Second standalone external test plugin whose {@link PackageBuild} contributions overlap
 * {@link ExternalProbePlugin} so set-union deduplication and list-append ordering are verified
 * outside core.
 */
public final class ExternalOverlapPlugin implements RosToolingPlugin {

    public static final String ID = "de.example.extoverlap";

    private static final EClass OVERLAP_SCHEMA = createSchema();
    private static final BlockDescriptor OVERLAP_BLOCK = new BlockDescriptor(
            "overlap",
            OVERLAP_SCHEMA,
            EnumSet.of(HookLocation.NODE, HookLocation.SYSTEM),
            Map.of(),
            "Overlap build test block (`@overlap`)");

    private static EClass createSchema() {
        EcoreFactory ef = EcoreFactory.eINSTANCE;
        EPackage ePkg = ef.createEPackage();
        ePkg.setName("extoverlap");
        ePkg.setNsPrefix("extoverlap");
        ePkg.setNsURI("http://example.org/rostooling/extoverlap");

        EClass cls = ef.createEClass();
        cls.setName("OverlapBlock");

        EAttribute noteAttr = ef.createEAttribute();
        noteAttr.setName("note");
        noteAttr.setEType(EcorePackage.Literals.ESTRING);
        noteAttr.setLowerBound(1);
        cls.getEStructuralFeatures().add(noteAttr);

        ePkg.getEClassifiers().add(cls);
        return cls;
    }

    @Override
    public String id() {
        return ID;
    }

    @Override
    public List<String> dependencies() {
        return List.of(ExternalProbePlugin.ID);
    }

    @Override
    public List<BlockDescriptor> blocks() {
        return List.of(OVERLAP_BLOCK);
    }

    @Override
    public void validate(final ValidationContext context) {
        // Schema validation handled cleanly by core.
    }

    @Override
    public void generatePackage(final PackageGenerationContext context) {
        boolean hasOverlap = false;
        boolean hasProbe = false;
        for (Artifact art : context.packageModel().getArtifact()) {
            if (art.getNode() != null) {
                if (context.typedBlock(art.getNode(), "overlap") != null) {
                    hasOverlap = true;
                }
                if (context.typedBlock(art.getNode(), "probe") != null) {
                    hasProbe = true;
                }
            }
        }
        if (!hasOverlap && !hasProbe) {
            return;
        }
        context.writeFile("plugins/de.example.extoverlap/overlap.txt", "overlap_ok\n");
        PackageBuild pb = context.packageBuild();
        pb.addDepend("std_msgs");
        pb.addDepend("rclcpp");
        pb.addFindPackage("std_msgs");
        pb.addInstallDirectory("plugins/de.example.extoverlap", "share/${PROJECT_NAME}/extoverlap", false);
    }
}
