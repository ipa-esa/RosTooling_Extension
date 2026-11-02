package de.fraunhofer.ipa.rossystem.scoping;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import org.eclipse.emf.common.util.EList;
import org.eclipse.emf.ecore.EObject;
import org.eclipse.emf.ecore.EReference;
import org.eclipse.emf.ecore.util.EcoreUtil;
import org.eclipse.xtext.EcoreUtil2;
import org.eclipse.xtext.naming.QualifiedName;
import org.eclipse.xtext.resource.EObjectDescription;
import org.eclipse.xtext.resource.IEObjectDescription;
import org.eclipse.xtext.scoping.IScope;
import org.eclipse.xtext.scoping.impl.SimpleScope;
import org.eclipse.xtext.xbase.lib.Pair;
import ros.ActionClient;
import ros.ActionServer;
import ros.Node;
import ros.Publisher;
import ros.ServiceClient;
import ros.ServiceServer;
import ros.Subscriber;
import system.Component;
import system.RosActionClientReference;
import system.RosActionServerReference;
import system.RosInterface;
import system.RosNode;
import system.RosPublisherReference;
import system.RosServiceClientReference;
import system.RosServiceServerReference;
import system.RosSubscriberReference;
import system.RossystemFactory;
import system.RossystemPackage;
import system.SubSystem;
import system.System;

/**
 * Custom scoping provider for RosSystem connections.
 * 
 * Supports:
 *  1. Short unqualified names (e.g., 'filtered_image_pub') whenever the interface name
 *     is uniquely resolvable across the entire system AND its subsystems (100% backward-compatible).
 *  2. Colon-scoped qualified names (e.g., 'node1::map', 'sub1::node1::map')
 *     to deterministically resolve connections when multiple nodes (including across subsystems)
 *     declare identically named interfaces.
 *  3. Automatic synthetic interface exposure for nodes that do not declare explicit 'interfaces:' blocks.
 */
public class RosSystemScopeProvider extends AbstractRosSystemScopeProvider {

  @Override
  public IScope getScope(final EObject context, final EReference reference) {
    if (Objects.equals(reference, RossystemPackage.Literals.ROS_SYSTEM_CONNECTION__FROM) ||
        Objects.equals(reference, RossystemPackage.Literals.ROS_SYSTEM_CONNECTION__TO)) {
      final System system = EcoreUtil2.getContainerOfType(context, System.class);
      if (system != null) {
        return this.getRosInterfaceScope(system);
      }
    }
    return super.getScope(context, reference);
  }

  public IScope getRosInterfaceScope(final System rootSystem) {
    // Collect all explicit and synthetic RosInterfaces along with their hierarchical path prefixes
    final List<Pair<String, RosInterface>> allInterfaces = new ArrayList<>();
    // Count distinct nodes across root system and all subsystems that expose each interface name
    final Map<String, Integer> nameCounts = new HashMap<>();
    final Set<System> visitedSystems = new HashSet<>();

    collectSystemInterfaces(rootSystem, "", rootSystem, allInterfaces, nameCounts, visitedSystems);

    final List<IEObjectDescription> descriptions = new ArrayList<>();
    final Set<QualifiedName> addedNames = new HashSet<>();

    for (final Pair<String, RosInterface> entry : allInterfaces) {
      final String nodePrefix = entry.getKey();
      final RosInterface iface = entry.getValue();
      final String ifaceName = iface.getName();

      if (ifaceName != null && !ifaceName.isEmpty()) {
        // 1. Qualified names:
        // Strictly use colon format (::) to avoid confusion
        if (!nodePrefix.isEmpty()) {
          // Colon-colon qualified: e.g. "rviz2::map" or "sub1::node1::map"
          String colonQualified = nodePrefix.replace(".", "::") + "::" + ifaceName;
          QualifiedName qnColon = QualifiedName.create(colonQualified);
          if (addedNames.add(qnColon)) {
            descriptions.add(EObjectDescription.create(qnColon, iface));
          }

          // If nodePrefix contains subsystem (e.g. "sub1.node1"), also export direct "node1::iface"
          int lastDot = nodePrefix.lastIndexOf('.');
          if (lastDot >= 0) {
            String bareNode = nodePrefix.substring(lastDot + 1);
            if (!bareNode.isEmpty()) {
              QualifiedName qnBareColon = QualifiedName.create(bareNode + "::" + ifaceName);
              if (addedNames.add(qnBareColon)) {
                descriptions.add(EObjectDescription.create(qnBareColon, iface));
              }
            }
          }
        }

        // 2. Short unqualified name (e.g., 'downsampled_costmap') - ONLY if strictly unique (count == 1)
        Integer count = nameCounts.get(ifaceName);
        if (count != null && count.intValue() == 1) {
          QualifiedName qnShort = QualifiedName.create(ifaceName);
          if (addedNames.add(qnShort)) {
            descriptions.add(EObjectDescription.create(qnShort, iface));
          }
        }
      }
    }

    return new SimpleScope(descriptions);
  }

  private void collectSystemInterfaces(
      final System currentSystem,
      final String prefix,
      final System rootSystem,
      final List<Pair<String, RosInterface>> allInterfaces,
      final Map<String, Integer> nameCounts,
      final Set<System> visitedSystems) {

    if (currentSystem == null || !visitedSystems.add(currentSystem)) {
      return;
    }

    EList<Component> components = currentSystem.getComponents();
    if (components == null) return;

    for (final Component component : components) {
      if (component instanceof RosNode) {
        final RosNode rosNode = (RosNode) component;
        final String nodeName = rosNode.getName() != null ? rosNode.getName() : "";
        final String nodePrefix = prefix.isEmpty() ? nodeName : prefix + "." + nodeName;

        // Distinct interface names exposed by this specific node
        final Set<String> nodeExposedNames = new HashSet<>();

        // (a) If the node explicitly declared interfaces, use them
        EList<RosInterface> interfaces = rosNode.getRosinterfaces();
        if (interfaces != null && !interfaces.isEmpty()) {
          for (final RosInterface iface : interfaces) {
            allInterfaces.add(Pair.of(nodePrefix, iface));
            if (iface.getName() != null && !iface.getName().isEmpty()) {
              nodeExposedNames.add(iface.getName());
            }
          }
        } else {
          // (b) Node declares no explicit interfaces: synthesize RosInterfaces from rosNode.getFrom()
          Node fromNode = rosNode.getFrom();
          if (fromNode != null && fromNode.eIsProxy()) {
            fromNode = (Node) EcoreUtil.resolve(fromNode, rootSystem);
          }
          if (fromNode != null && !fromNode.eIsProxy()) {
            Set<String> existingNames = new HashSet<>();
            if (rosNode.getRosinterfaces() != null) {
              for (RosInterface ex : rosNode.getRosinterfaces()) {
                if (ex.getName() != null) existingNames.add(ex.getName());
              }
            }

            if (fromNode.getPublisher() != null) {
              for (Publisher pub : fromNode.getPublisher()) {
                if (pub.getName() != null && !pub.getName().isEmpty()) {
                  if (existingNames.add(pub.getName())) {
                    RosInterface iface = RossystemFactory.eINSTANCE.createRosInterface();
                    iface.setName(pub.getName());
                    RosPublisherReference ref = RossystemFactory.eINSTANCE.createRosPublisherReference();
                    ref.setFrom(pub);
                    iface.setReference(ref);
                    rosNode.getRosinterfaces().add(iface);
                    allInterfaces.add(Pair.of(nodePrefix, iface));
                    nodeExposedNames.add(pub.getName());
                  }
                }
              }
            }

            if (fromNode.getSubscriber() != null) {
              for (Subscriber sub : fromNode.getSubscriber()) {
                if (sub.getName() != null && !sub.getName().isEmpty()) {
                  if (existingNames.add(sub.getName())) {
                    RosInterface iface = RossystemFactory.eINSTANCE.createRosInterface();
                    iface.setName(sub.getName());
                    RosSubscriberReference ref = RossystemFactory.eINSTANCE.createRosSubscriberReference();
                    ref.setFrom(sub);
                    iface.setReference(ref);
                    rosNode.getRosinterfaces().add(iface);
                    allInterfaces.add(Pair.of(nodePrefix, iface));
                    nodeExposedNames.add(sub.getName());
                  }
                }
              }
            }

            if (fromNode.getServiceserver() != null) {
              for (ServiceServer ss : fromNode.getServiceserver()) {
                if (ss.getName() != null && !ss.getName().isEmpty()) {
                  if (existingNames.add(ss.getName())) {
                    RosInterface iface = RossystemFactory.eINSTANCE.createRosInterface();
                    iface.setName(ss.getName());
                    RosServiceServerReference ref = RossystemFactory.eINSTANCE.createRosServiceServerReference();
                    ref.setFrom(ss);
                    iface.setReference(ref);
                    rosNode.getRosinterfaces().add(iface);
                    allInterfaces.add(Pair.of(nodePrefix, iface));
                    nodeExposedNames.add(ss.getName());
                  }
                }
              }
            }

            if (fromNode.getServiceclient() != null) {
              for (ServiceClient sc : fromNode.getServiceclient()) {
                if (sc.getName() != null && !sc.getName().isEmpty()) {
                  if (existingNames.add(sc.getName())) {
                    RosInterface iface = RossystemFactory.eINSTANCE.createRosInterface();
                    iface.setName(sc.getName());
                    RosServiceClientReference ref = RossystemFactory.eINSTANCE.createRosServiceClientReference();
                    ref.setFrom(sc);
                    iface.setReference(ref);
                    rosNode.getRosinterfaces().add(iface);
                    allInterfaces.add(Pair.of(nodePrefix, iface));
                    nodeExposedNames.add(sc.getName());
                  }
                }
              }
            }

            if (fromNode.getActionserver() != null) {
              for (ActionServer as : fromNode.getActionserver()) {
                if (as.getName() != null && !as.getName().isEmpty()) {
                  if (existingNames.add(as.getName())) {
                    RosInterface iface = RossystemFactory.eINSTANCE.createRosInterface();
                    iface.setName(as.getName());
                    RosActionServerReference ref = RossystemFactory.eINSTANCE.createRosActionServerReference();
                    ref.setFrom(as);
                    iface.setReference(ref);
                    rosNode.getRosinterfaces().add(iface);
                    allInterfaces.add(Pair.of(nodePrefix, iface));
                    nodeExposedNames.add(as.getName());
                  }
                }
              }
            }

            if (fromNode.getActionclient() != null) {
              for (ActionClient ac : fromNode.getActionclient()) {
                if (ac.getName() != null && !ac.getName().isEmpty()) {
                  if (existingNames.add(ac.getName())) {
                    RosInterface iface = RossystemFactory.eINSTANCE.createRosInterface();
                    iface.setName(ac.getName());
                    RosActionClientReference ref = RossystemFactory.eINSTANCE.createRosActionClientReference();
                    ref.setFrom(ac);
                    iface.setReference(ref);
                    rosNode.getRosinterfaces().add(iface);
                    allInterfaces.add(Pair.of(nodePrefix, iface));
                    nodeExposedNames.add(ac.getName());
                  }
                }
              }
            }
          }
        }

        // Increment count for each distinct interface name exposed by this node
        for (final String ifaceName : nodeExposedNames) {
          int count = nameCounts.getOrDefault(ifaceName, 0);
          nameCounts.put(ifaceName, count + 1);
        }

      } else if (component instanceof SubSystem) {
        System subSystem = ((SubSystem) component).getSystem();
        if (subSystem != null && subSystem.eIsProxy()) {
          subSystem = (System) EcoreUtil.resolve(subSystem, rootSystem);
        }
        if (subSystem != null && !subSystem.eIsProxy()) {
          final String subName = subSystem.getName() != null ? subSystem.getName() : "";
          final String subPrefix = prefix.isEmpty() ? subName : prefix + "." + subName;
          collectSystemInterfaces(subSystem, subPrefix, rootSystem, allInterfaces, nameCounts, visitedSystems);
        }
      }
    }
  }
}
