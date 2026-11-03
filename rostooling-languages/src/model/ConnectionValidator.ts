import { RosInteractionKind, RosInterface, RosNode, RosProject, ConnectionValidationResult } from './RosModelTypes';

export const KIND_ORDER: RosInteractionKind[] = ['pub', 'sub', 'ss', 'sc', 'as', 'ac', 'param'];

export const KIND_LABELS: Record<RosInteractionKind, string> = {
  pub: 'Publisher',
  sub: 'Subscriber',
  ss: 'Service Server',
  sc: 'Service Client',
  as: 'Action Server',
  ac: 'Action Client',
  param: 'Parameter',
};

export const COMPLEMENT_KINDS: Record<string, RosInteractionKind> = {
  pub: 'sub',
  sub: 'pub',
  ss: 'sc',
  sc: 'ss',
  as: 'ac',
  ac: 'as',
};

export const SRC_SIDE: Record<string, boolean> = {
  pub: true,
  ss: true,
  as: true,
  sub: false,
  sc: false,
  ac: false,
};

export interface PortTokens {
  baseName: string | null;
  remapName: string | null;
  bound: string | null;
}

export interface PortMatchResult {
  matched: boolean;
  tier: 'remap' | 'directed-remap' | 'contract' | null;
  resolvedName: string | null;
}

export const ConnectionValidator = {
  /**
   * Validate if two interface ports can be connected.
   */
  validate(
    sourceNode: RosNode,
    sourceIface: RosInterface,
    targetNode: RosNode,
    targetIface: RosInterface,
    existingConnections: { from: { n: string; i: string }; to: { n: string; i: string } }[] = []
  ): ConnectionValidationResult {
    // 1. Self connection check
    if (sourceNode.id === targetNode.id) {
      return {
        valid: false,
        reason: `Cannot connect node "${sourceNode.label}" to itself`,
      };
    }

    // 2. Kind compatibility check
    const expectedTargetKind = COMPLEMENT_KINDS[sourceIface.kind];
    if (!expectedTargetKind) {
      return {
        valid: false,
        reason: `Port "${sourceIface.name}" of kind "${KIND_LABELS[sourceIface.kind]}" is not connectable`,
      };
    }

    if (targetIface.kind !== expectedTargetKind) {
      return {
        valid: false,
        reason: `Incompatible kinds: Cannot connect ${KIND_LABELS[sourceIface.kind]} (${sourceIface.kind}) to ${KIND_LABELS[targetIface.kind]} (${targetIface.kind}). Expected ${KIND_LABELS[expectedTargetKind]}.`,
      };
    }

    // 3. Message/Service/Action Type matching check
    const srcType = (sourceIface.type || '').trim();
    const tgtType = (targetIface.type || '').trim();

    const cleanSrc = srcType.replace(/^['"]|['"]$/g, '').trim();
    const cleanTgt = tgtType.replace(/^['"]|['"]$/g, '').trim();
    const normSrc = cleanSrc.replace(/\/msg\//, '/').replace(/\/srv\//, '/').replace(/\/action\//, '/');
    const normTgt = cleanTgt.replace(/\/msg\//, '/').replace(/\/srv\//, '/').replace(/\/action\//, '/');
    const isTypeMatch =
      cleanSrc === cleanTgt ||
      normSrc === normTgt ||
      (cleanSrc.includes('/') && !cleanTgt.includes('/') && cleanSrc.endsWith('/' + cleanTgt)) ||
      (!cleanSrc.includes('/') && cleanTgt.includes('/') && cleanTgt.endsWith('/' + cleanSrc));

    if (cleanSrc && cleanTgt && cleanSrc !== '—' && cleanTgt !== '—' && !isTypeMatch) {
      return {
        valid: false,
        reason: `Type mismatch: Source type "${srcType}" does not match target type "${tgtType}".`,
      };
    }

    // Determine canonical from (source) -> to (sink)
    const isSourceFrom = SRC_SIDE[sourceIface.kind];
    const fromEnd = isSourceFrom
      ? { n: sourceNode.id, i: sourceIface.id, kind: sourceIface.kind }
      : { n: targetNode.id, i: targetIface.id, kind: targetIface.kind };
    const toEnd = isSourceFrom
      ? { n: targetNode.id, i: targetIface.id, kind: targetIface.kind }
      : { n: sourceNode.id, i: sourceIface.id, kind: sourceIface.kind };

    // 4. Duplicate connection check
    const isDuplicate = existingConnections.some(
      (c) => c.from.n === fromEnd.n && c.from.i === fromEnd.i && c.to.n === toEnd.n && c.to.i === toEnd.i
    );

    if (isDuplicate) {
      return {
        valid: false,
        reason: `Connection already exists between "${sourceIface.name}" and "${targetIface.name}".`,
      };
    }

    return {
      valid: true,
      reason: `Compatible: ${srcType || tgtType || 'Unspecified Type'}`,
      normalizedFrom: fromEnd,
      normalizedTo: toEnd,
    };
  },

  /**
   * Find all ports in the project that are legally compatible with the given source interface.
   */
  getCompatiblePortKeys(
    sourceNode: RosNode,
    sourceIface: RosInterface,
    project: RosProject
  ): Set<string> {
    const legalPortKeys = new Set<string>();
    const expectedKind = COMPLEMENT_KINDS[sourceIface.kind];
    if (!expectedKind) return legalPortKeys;

    const srcType = (sourceIface.type || '').trim();

    for (const node of project.nodes) {
      if (node.id === sourceNode.id) continue;

      for (const iface of node.ifaces) {
        if (iface.kind === expectedKind) {
          const tgtType = (iface.type || '').trim();
          if (!srcType || !tgtType || srcType === tgtType) {
            legalPortKeys.add(`${node.id}:${iface.id}`);
          }
        }
      }
    }

    return legalPortKeys;
  },

  /**
   * Return formatted status text for the live floating HUD tooltip during wire drag.
   */
  getDragStatusHUD(
    sourceNode: RosNode,
    sourceIface: RosInterface,
    hoverNode?: RosNode,
    hoverIface?: RosInterface,
    existingConnections: { from: { n: string; i: string }; to: { n: string; i: string } }[] = []
  ): { status: 'idle' | 'valid' | 'invalid'; text: string; subText?: string } {
    const srcType = sourceIface.type || 'Unspecified';
    const srcKindLabel = KIND_LABELS[sourceIface.kind];
    const wantKindLabel = COMPLEMENT_KINDS[sourceIface.kind]
      ? KIND_LABELS[COMPLEMENT_KINDS[sourceIface.kind]]
      : 'None';

    if (!hoverNode || !hoverIface) {
      return {
        status: 'idle',
        text: `Dragging ${srcKindLabel}: "${sourceIface.name}"`,
        subText: `Type: ${srcType} -> Target: ${wantKindLabel}`,
      };
    }

    const validation = this.validate(sourceNode, sourceIface, hoverNode, hoverIface, existingConnections);

    if (validation.valid) {
      return {
        status: 'valid',
        text: `✅ Connect to "${hoverNode.label} :: ${hoverIface.name}"`,
        subText: `Match: [${srcType}]`,
      };
    } else {
      return {
        status: 'invalid',
        text: `⛔ ${validation.reason || 'Invalid Connection'}`,
        subText: `Source: ${sourceIface.name} (${srcType})`,
      };
    }
  },

  /**
   * Extract base contract name, remapped name, and studio port binding tokens.
   */
  getPortTokens(
    node: { id?: string; label?: string },
    iface: { id?: string; name?: string; label?: string },
    project?: { studio?: { modules?: Record<string, { portBindings?: Record<string, string> }> } }
  ): PortTokens {
    const bound = project?.studio?.modules?.[node?.id || '']?.portBindings?.[iface?.id || ''];
    const cleanBound = bound ? String(bound).trim().replace(/^\/+/, '') : null;
    const cleanName = iface?.name ? String(iface.name).trim().replace(/^\/+/, '') : null;
    const cleanLabel = iface?.label ? String(iface.label).trim().replace(/^\/+/, '') : null;

    const remapName = cleanBound || cleanLabel || null;
    const baseName = cleanName || cleanLabel || null;

    return { baseName, remapName, bound: cleanBound };
  },

  /**
   * Tiered interface matching for auto-wiring:
   * - Tier 1: Intentional Remapping Match (Both ports explicitly remapped or bound to the same topic/service name)
   * - Tier 2: Directed Remapping Match (One port remapped to target the other component's interface name)
   * - Tier 3: Underlying Contract Match (Both ports share the same default ROS interface name)
   */
  portsMatch(
    nodeA: { id?: string; label?: string },
    ifaceA: { id?: string; name?: string; label?: string },
    nodeB: { id?: string; label?: string },
    ifaceB: { id?: string; name?: string; label?: string },
    project?: { studio?: { modules?: Record<string, { portBindings?: Record<string, string> }> } }
  ): PortMatchResult {
    const tokA = this.getPortTokens(nodeA, ifaceA, project);
    const tokB = this.getPortTokens(nodeB, ifaceB, project);

    // 1. Tier 1: Intentional Remapping Match (Both ports bound or remapped to the exact same name)
    if (tokA.remapName && tokB.remapName && tokA.remapName === tokB.remapName) {
      return { matched: true, tier: 'remap', resolvedName: tokA.remapName };
    }

    // 2. Tier 2: Directed Remapping Match (One port remapped to target the other port)
    if (tokA.remapName && tokB.baseName && tokA.remapName === tokB.baseName) {
      return { matched: true, tier: 'directed-remap', resolvedName: tokB.baseName };
    }
    if (tokB.remapName && tokA.baseName && tokB.remapName === tokA.baseName) {
      return { matched: true, tier: 'directed-remap', resolvedName: tokA.baseName };
    }

    // 3. Tier 3: Underlying Contract Match (Both ports declare the same ROS interface name)
    if (tokA.baseName && tokB.baseName && tokA.baseName === tokB.baseName) {
      return { matched: true, tier: 'contract', resolvedName: tokA.baseName };
    }

    return { matched: false, tier: null, resolvedName: null };
  },

  /**
   * Auto-connect matching interfaces across all nodes in the project based on the tiered matching algorithm.
   */
  autoConnectMatching(
    proj: RosProject,
    skipped: string[] = [],
    connected: string[] = []
  ): { connectionsAdded: number } {
    if (!proj.connections) {
      proj.connections = [];
    }
    let count = 0;
    const nodes = proj.nodes || [];
    for (const a of nodes) {
      for (const f of a.ifaces || []) {
        if (f.exposed === false) continue;
        if (!SRC_SIDE[f.kind]) continue;
        for (const b of nodes) {
          if (b.id === a.id) continue;
          if (a.subRef && a.subRef === b.subRef) continue;
          for (const t of b.ifaces || []) {
            if (t.exposed === false) continue;
            if (t.kind !== COMPLEMENT_KINDS[f.kind]) continue;

            const matchResult = this.portsMatch(a, f, b, t, proj);
            if (!matchResult.matched) continue;
            const srcResolvedName = matchResult.resolvedName || '';

            // Dynamic runtime token guard ({...})
            if (
              (f.name || '').includes('{') ||
              (f.label || '').includes('{') ||
              (t.name || '').includes('{') ||
              (t.label || '').includes('{') ||
              srcResolvedName.includes('{')
            ) {
              skipped.push(`${a.label} ${f.label || f.name} -> ${b.label}: dynamic token`);
              continue;
            }

            const val = this.validate(a, f, b, t, proj.connections);
            const wireLabel = `${a.label} ${srcResolvedName} -> ${b.label}`;
            if (!val.valid) {
              if (!/already exists/i.test(val.reason || '')) {
                skipped.push(`${wireLabel}: ${val.reason}`);
              }
              continue;
            }

            if (!f.type) f.type = t.type;
            if (!t.type) t.type = f.type;

            const connId = `c_${f.id}_${t.id}_${proj.connections.length + 1}`;
            proj.connections.push({
              id: connId,
              from: { n: a.id, i: f.id, kind: f.kind },
              to: { n: b.id, i: t.id, kind: t.kind },
              type: f.type || t.type,
              resolvedName: srcResolvedName,
              matchTier: matchResult.tier || undefined,
            });
            connected.push(`${wireLabel} (${matchResult.tier})`);
            count++;
          }
        }
      }
    }
    return { connectionsAdded: count };
  },
};
