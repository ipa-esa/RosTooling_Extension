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

    if (srcType && tgtType && srcType !== tgtType) {
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
};
