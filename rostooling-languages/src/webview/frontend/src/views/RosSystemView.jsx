import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  MarkerType,
  useNodesState,
  useEdgesState,
  useReactFlow,
} from '@xyflow/react';
import {
  Box,
  Layers,
  Cpu,
  Plus,
  Trash2,
  ExternalLink,
  Unplug,
  ArrowRight,
  Search,
  AlertCircle,
  Activity,
} from 'lucide-react';
import {
  useStudio,
  setUIState,
  mutateProject,
  mutateLayout,
  updateNodeLabel,
  importCatalogueNode,
  validatePortConnection,
  KIND_META,
  SRC_SIDE,
  showToast,
} from '../state/studioStore';
import { hostBridge } from '../state/vscodeBridge';
import { RosNodeCard } from '../components/RosNodeCard';
import { ProcessGroupNode } from '../components/ProcessGroupNode';
import { SubsystemNodeCard } from '../components/SubsystemNodeCard';
import { JumpOrthogonalEdge } from '../components/JumpOrthogonalEdge';
import { insertWaypointIntoConnection } from '../state/orthogonalRouter';

const NODE_TYPES = {
  rosNode: RosNodeCard,
  processGroup: ProcessGroupNode,
  subsystemNode: SubsystemNodeCard,
};

const EDGE_TYPES = {
  jumpOrthogonal: JumpOrthogonalEdge,
};

const PAD_X = 36;
const PAD_TOP = 58;
const PAD_BOTTOM = 38;

export function estimateCardWidth(node) {
  // Base card width in CSS is 280px, but React Flow port handles protrude ~6px
  // on each side, and cards with wide names or parameter badges expand up to 300-320px.
  return Math.max(node?.w || 0, 300);
}

export function estimateCardHeight(node) {
  if (!node) return 140;

  // 1. Header: icon (16px), title (~18px), padding (18px), border (1px) = ~37px.
  // Optional subtitle (from / package / artifact) adds another ~16px text block.
  const hasSubtitle = Boolean(
    node.from ||
    (node.pkg ? `${node.pkg}.${node.artifact || node.label}` : node.artifact)
  );
  const headerHeight = hasSubtitle ? 54 : 38;

  // 2. Badges row (lifecycle, namespace, parameters, diagnostics, subsystem)
  // .rt-node-badges has 9px padding/border. Badges wrap when multiple are present (~2 per line).
  const diags = node.diagnostics || [];
  const errCount = diags.filter((d) => d.severity === 'error').length;
  const warnCount = diags.filter((d) => d.severity === 'warning').length;
  const totalParams = (node.params || []).length;

  let badgeCount = 0;
  if (node.isLifecycle) badgeCount++;
  if (node.namespace) badgeCount++;
  if (totalParams > 0) badgeCount++;
  if (node.subRef) badgeCount++;
  if (errCount > 0) badgeCount++;
  if (warnCount > 0) badgeCount++;

  let badgesHeight = 0;
  if (badgeCount > 0) {
    const badgeRows = Math.max(1, Math.ceil(badgeCount / 2.2));
    badgesHeight = 9 + badgeRows * 22;
  }

  // 3. Ports container
  // .rt-ports-container: padding 5px 0 (10px).
  // Each port row has padding 4px 12px and vertical stack of port name (~16px) + port type (~14px) = 38px.
  const exposedIfaces = (node.ifaces || []).filter((f) => f.exposed !== false);
  let portsHeight = 0;
  if (exposedIfaces.length === 0) {
    portsHeight = 36;
  } else {
    portsHeight = 10 + exposedIfaces.length * 38;
  }

  // 4. Parameter overrides/rows (if node has parameters expanded or listed)
  const paramRowsHeight = node.showParams && totalParams > 0 ? totalParams * 28 : 0;

  // 5. Card container border (1.5px top + 1.5px bottom) + breathing margin
  const cardBorderAndBuffer = 8;

  const totalHeight = headerHeight + badgesHeight + portsHeight + paramRowsHeight + cardBorderAndBuffer;

  return Math.max(140, Math.ceil(totalHeight));
}

function resolveHandleEndpoint(rfNodeId, rfHandleId, project) {
  if (!rfNodeId || !rfHandleId) return { node: null, iface: null };
  if (rfNodeId.startsWith('sub_') && rfHandleId.includes('::')) {
    const [memberId, ifaceId] = rfHandleId.split('::');
    const memberNode = (project.nodes || []).find((n) => n.id === memberId);
    const iface = (memberNode?.ifaces || []).find((f) => f.id === ifaceId);
    return { node: memberNode || null, iface: iface || null };
  }
  const node = (project.nodes || []).find((n) => n.id === rfNodeId);
  const iface = (node?.ifaces || []).find(
    (f) => f.id === rfHandleId || f.label === rfHandleId || f.name === rfHandleId
  );
  return { node: node || null, iface: iface || null };
}

function SystemCanvasInner() {
  const studio = useStudio();
  const rfInstance = useReactFlow();
  const [canvasSearch, setCanvasSearch] = useState('');

  const {
    project,
    isReadOnly,
    interfaceFilter,
    selectedNodeId,
    selectedEdgeId,
    selectedSubsystemRef,
    selectedProcessName,
    fitTrigger,
  } = studio;

  const handleMoveMidX = useCallback((connId, newMidX) => {
    mutateLayout((proj) => {
      if (!proj.view) proj.view = {};
      if (!proj.view.connMidX) proj.view.connMidX = {};
      proj.view.connMidX[connId] = newMidX;
      const conn = (proj.connections || []).find((c) => c.id === connId);
      if (conn) conn.midX = newMidX;
    });
  }, []);

  const handleMoveMidY = useCallback((connId, newMidY) => {
    mutateLayout((proj) => {
      if (!proj.view) proj.view = {};
      if (!proj.view.connMidY) proj.view.connMidY = {};
      proj.view.connMidY[connId] = newMidY;
      const conn = (proj.connections || []).find((c) => c.id === connId);
      if (conn) conn.midY = newMidY;
    });
  }, []);

  const handleMoveWaypoint = useCallback((connId, wpIdx, newX, newY) => {
    mutateLayout((proj) => {
      if (!proj.view) proj.view = {};
      if (!proj.view.connWaypoints) proj.view.connWaypoints = {};
      const conn = (proj.connections || []).find((c) => c.id === connId);
      if (conn && conn.waypoints && conn.waypoints[wpIdx]) {
        conn.waypoints[wpIdx] = { x: newX, y: newY };
        proj.view.connWaypoints[connId] = [...conn.waypoints];
      }
    });
  }, []);

  const handleAddWaypoint = useCallback((connId, clickX, clickY, existingPts) => {
    mutateLayout((proj) => {
      if (!proj.view) proj.view = {};
      if (!proj.view.connWaypoints) proj.view.connWaypoints = {};
      const conn = (proj.connections || []).find((c) => c.id === connId);
      if (conn) {
        conn.waypoints = insertWaypointIntoConnection(conn.waypoints, clickX, clickY, existingPts);
        proj.view.connWaypoints[connId] = [...conn.waypoints];
      }
    });
  }, []);

  const handleDeleteWaypoint = useCallback((connId, wpIdx) => {
    mutateLayout((proj) => {
      if (!proj.view) proj.view = {};
      if (!proj.view.connWaypoints) proj.view.connWaypoints = {};
      const conn = (proj.connections || []).find((c) => c.id === connId);
      if (conn && conn.waypoints) {
        conn.waypoints.splice(wpIdx, 1);
        proj.view.connWaypoints[connId] = [...conn.waypoints];
      }
    });
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      rfInstance.fitView({ padding: 0.18, maxZoom: 1.05, duration: 220 });
    }, 60);
    return () => clearTimeout(timer);
  }, [fitTrigger, rfInstance]);

  const handleToggleSubsystem = useCallback((subRef) => {
    mutateLayout((proj) => {
      if (!proj.view) proj.view = {};
      if (!proj.view.subStates) proj.view.subStates = {};
      const sub = (proj.subSystems || []).find((s) => s.ref === subRef);
      const curState = proj.view.subStates[subRef] || sub?.state || 'collapsed';
      const nextState = curState === 'framed' ? 'collapsed' : 'framed';
      proj.view.subStates[subRef] = nextState;
      if (sub) sub.state = nextState;
    });
  }, []);

  // Compute parent origins + React Flow nodes & edges
  const { computedNodes, parentOrigins, computedEdges } = useMemo(() => {
    const rfNodes = [];
    const origins = {};
    const diags = project.diagnostics || [];
    const q = canvasSearch.trim().toLowerCase();

    const directNodes = (project.nodes || []).filter((n) => !n.subRef && n.backing !== 'sub');
    directNodes.forEach((node, idx) => {
      if (node.x == null) node.x = 80 + (idx % 3) * 360;
      if (node.y == null) node.y = 80 + Math.floor(idx / 3) * 280;
    });

    const nodeToProcess = new Map();
    for (const proc of project.processes || []) {
      for (const nl of proc.nodes || []) {
        nodeToProcess.set(nl, proc.name);
      }
    }

    // 1. Process Group Container Nodes (parent nodes MUST come first!)
    (project.processes || []).forEach((proc, pIdx) => {
      const procId = `proc_${proc.name}`;
      const members = directNodes.filter((n) => nodeToProcess.get(n.label) === proc.name);
      let originX;
      let originY;
      let width;
      let height;

      if (members.length > 0) {
        const minX = Math.min(...members.map((m) => m.x)) - PAD_X;
        const minY = Math.min(...members.map((m) => m.y)) - PAD_TOP;
        const maxX = Math.max(...members.map((m) => m.x + estimateCardWidth(m))) + PAD_X;
        const maxY = Math.max(...members.map((m) => m.y + estimateCardHeight(m))) + PAD_BOTTOM;
        originX = minX;
        originY = minY;
        width = Math.max(360, maxX - minX);
        height = Math.max(200, maxY - minY);
      } else {
        const saved = project.view?.subPos?.[procId];
        originX = saved?.x ?? 80 + pIdx * 370;
        originY = saved?.y ?? 420;
        width = 360;
        height = 160;
      }

      origins[procId] = { x: originX, y: originY };
      const procDiags = diags.filter(
        (d) => d.elementKind === 'process' && (d.elementId === proc.name || d.targetName === proc.name)
      );

      rfNodes.push({
        id: procId,
        type: 'processGroup',
        position: { x: originX, y: originY },
        style: { width, height, zIndex: -1 },
        selected: selectedProcessName === proc.name,
        data: {
          process: proc,
          diagnostics: procDiags,
        },
      });
    });

    // 2. Subsystem Nodes (collapsed cards OR framed group containers)
    const collapsedSubRefs = new Set();
    (project.subSystems || []).forEach((sub, sIdx) => {
      const subId = `sub_${sub.ref}`;
      const isFramed = (project.view?.subStates?.[sub.ref] || sub.state) === 'framed';
      const members = (project.nodes || []).filter((n) => n.subRef === sub.ref);

      if (!isFramed) {
        collapsedSubRefs.add(sub.ref);
        const pos = {
          x: sub.x ?? project.view?.subPos?.[sub.ref]?.x ?? 100 + sIdx * 350,
          y: sub.y ?? project.view?.subPos?.[sub.ref]?.y ?? 340,
        };
        origins[subId] = pos;

        const ports = [];
        for (const m of members) {
          for (const f of m.ifaces || []) {
            if (f.exposed === false) continue;
            ports.push({
              handleId: `${m.id}::${f.id}`,
              nodeId: m.id,
              nodeLabel: m.label,
              iface: f,
            });
          }
        }

        const matchesSearch =
          !q ||
          sub.ref.toLowerCase().includes(q) ||
          ports.some((p) => (p.iface.label || p.iface.name).toLowerCase().includes(q));

        rfNodes.push({
          id: subId,
          type: 'subsystemNode',
          position: pos,
          hidden: !matchesSearch,
          selected: selectedSubsystemRef === sub.ref,
          data: {
            subsystem: sub,
            isFramed: false,
            ports,
            memberCount: members.length || Object.keys(sub.graph?.nodes || {}).length,
            onToggleExpand: isReadOnly ? null : handleToggleSubsystem,
            interfaceFilter,
          },
        });
      } else {
        // Framed group container + child member nodes
        let originX;
        let originY;
        let width;
        let height;
        if (members.length > 0) {
          members.forEach((m, idx) => {
            if (m.x == null) m.x = (sub.x ?? 100) + PAD_X + idx * 320;
            if (m.y == null) m.y = (sub.y ?? 320) + PAD_TOP;
          });
          const minX = Math.min(...members.map((m) => m.x)) - PAD_X;
          const minY = Math.min(...members.map((m) => m.y)) - PAD_TOP;
          const maxX = Math.max(...members.map((m) => m.x + estimateCardWidth(m))) + PAD_X;
          const maxY = Math.max(...members.map((m) => m.y + estimateCardHeight(m))) + PAD_BOTTOM;
          originX = minX;
          originY = minY;
          width = Math.max(360, maxX - minX);
          height = Math.max(200, maxY - minY);
        } else {
          originX = sub.x ?? 100 + sIdx * 360;
          originY = sub.y ?? 320;
          width = 360;
          height = 180;
        }
        origins[subId] = { x: originX, y: originY };
        rfNodes.push({
          id: subId,
          type: 'subsystemNode',
          position: { x: originX, y: originY },
          style: { width, height, zIndex: -1 },
          selected: selectedSubsystemRef === sub.ref,
          data: {
            subsystem: sub,
            isFramed: true,
            ports: [],
            memberCount: members.length,
            onToggleExpand: isReadOnly ? null : handleToggleSubsystem,
            interfaceFilter,
          },
        });

        for (const m of members) {
          const mDiags = diags.filter((d) => d.elementId === m.id || d.targetName === m.label);
          rfNodes.push({
            id: m.id,
            type: 'rosNode',
            position: {
              x: m.x ?? originX + PAD_X,
              y: m.y ?? originY + PAD_TOP,
            },
            selected: selectedNodeId === m.id,
            data: {
              node: m,
              diagnostics: mDiags,
              interfaceFilter,
            },
          });
        }
      }
    });

    // 3. Direct System Nodes (standalone or inside a ProcessGroupNode)
    directNodes.forEach((node) => {
      const absX = node.x;
      const absY = node.y;

      const nodeDiags = diags.filter(
        (d) =>
          (d.elementKind === 'node' || d.elementKind === 'interface' || d.elementKind === 'parameter') &&
          (d.elementId === node.id || d.targetName === node.label)
      );

      const matchesSearch =
        !q ||
        node.label.toLowerCase().includes(q) ||
        (node.from || '').toLowerCase().includes(q) ||
        (node.pkg || '').toLowerCase().includes(q) ||
        (node.ifaces || []).some(
          (f) =>
            (f.label || f.name).toLowerCase().includes(q) ||
            (f.type || '').toLowerCase().includes(q)
        );

      rfNodes.push({
        id: node.id,
        type: 'rosNode',
        position: { x: absX, y: absY },
        hidden: !matchesSearch,
        selected: selectedNodeId === node.id,
        data: {
          node,
          diagnostics: nodeDiags,
          interfaceFilter,
        },
      });
    });

    // 4. Edges from project.connections
    const modeMap = {
      spline: 'default',
      linear: 'straight',
      orthogonal: 'jumpOrthogonal',
    };
    const defaultConnectorMode = project.view?.connectorMode || 'orthogonal';
    const defaultEdgeType = modeMap[defaultConnectorMode] || 'jumpOrthogonal';

    const rfEdges = [];
    for (const conn of project.connections || []) {
      const fromNode = (project.nodes || []).find((n) => n.id === conn.from.n);
      const toNode = (project.nodes || []).find((n) => n.id === conn.to.n);
      const fromIface = (fromNode?.ifaces || []).find(
        (f) => f.id === conn.from.i || f.label === conn.from.i || f.name === conn.from.i
      );
      const toIface = (toNode?.ifaces || []).find(
        (f) => f.id === conn.to.i || f.label === conn.to.i || f.name === conn.to.i
      );

      if (!fromNode || !toNode || !fromIface || !toIface) continue;

      if (
        interfaceFilter !== 'all' &&
        fromIface.kind !== interfaceFilter &&
        toIface.kind !== interfaceFilter
      ) {
        continue;
      }

      const fromCollapsedSub = fromNode.subRef && collapsedSubRefs.has(fromNode.subRef);
      const toCollapsedSub = toNode.subRef && collapsedSubRefs.has(toNode.subRef);

      const source = fromCollapsedSub ? `sub_${fromNode.subRef}` : fromNode.id;
      const sourceHandle = fromCollapsedSub ? `${fromNode.id}::${fromIface.id}` : fromIface.id;
      const target = toCollapsedSub ? `sub_${toNode.subRef}` : toNode.id;
      const targetHandle = toCollapsedSub ? `${toNode.id}::${toIface.id}` : toIface.id;

      const connDiags = diags.filter((d) => d.elementId === conn.id);
      const hasErr = connDiags.some((d) => d.severity === 'error');
      const strokeColor = hasErr
        ? '#ef4444'
        : KIND_META[fromIface.kind]?.color || '#4c9aff';
      const resolvedType = (fromIface.type || toIface.type || '').split('/').pop() || (fromIface.label || fromIface.name);
      const edgeType = conn.connectorMode
        ? (conn.connectorMode === 'orthogonal' ? 'jumpOrthogonal' : modeMap[conn.connectorMode] || 'jumpOrthogonal')
        : defaultEdgeType;

      rfEdges.push({
        id: conn.id,
        source,
        sourceHandle,
        target,
        targetHandle,
        type: edgeType,
        selected: selectedEdgeId === conn.id,
        label: resolvedType,
        markerEnd: { type: MarkerType.ArrowClosed, color: strokeColor },
        style: { stroke: strokeColor, strokeWidth: selectedEdgeId === conn.id ? 2.8 : 2 },
        data: {
          connection: conn,
          midX: conn.midX ?? project.view?.connMidX?.[conn.id],
          midY: conn.midY ?? project.view?.connMidY?.[conn.id],
          waypoints: conn.waypoints || project.view?.connWaypoints?.[conn.id] || [],
          isReadOnly,
          onMoveMidX: handleMoveMidX,
          onMoveMidY: handleMoveMidY,
          onMoveWaypoint: handleMoveWaypoint,
          onAddWaypoint: handleAddWaypoint,
          onDeleteWaypoint: handleDeleteWaypoint,
        },
      });
    }

    return { computedNodes: rfNodes, parentOrigins: origins, computedEdges: rfEdges };
  }, [
    project,
    interfaceFilter,
    selectedNodeId,
    selectedEdgeId,
    selectedSubsystemRef,
    selectedProcessName,
    canvasSearch,
    isReadOnly,
    handleToggleSubsystem,
    handleMoveMidX,
    handleMoveMidY,
    handleMoveWaypoint,
    handleAddWaypoint,
    handleDeleteWaypoint,
  ]);

  const [nodes, setNodes, onNodesChangeInternal] = useNodesState(computedNodes);
  const [edges, setEdges, onEdgesChangeInternal] = useEdgesState(computedEdges);

  useEffect(() => {
    setNodes(computedNodes);
  }, [computedNodes, setNodes]);

  useEffect(() => {
    setEdges(computedEdges);
  }, [computedEdges, setEdges]);

  const onNodesChange = useCallback(
    (changes) => {
      if (isReadOnly) return;
      onNodesChangeInternal(changes);
    },
    [isReadOnly, onNodesChangeInternal]
  );

  const onEdgesChange = useCallback(
    (changes) => {
      if (isReadOnly) return;
      onEdgesChangeInternal(changes);
    },
    [isReadOnly, onEdgesChangeInternal]
  );

  const onNodeDragStop = useCallback(
    (_, draggedNode) => {
      if (isReadOnly || !draggedNode) return;

      mutateLayout((proj) => {
        if (!proj.view) proj.view = {};
        if (!proj.view.subPos) proj.view.subPos = {};

        if (draggedNode.type === 'processGroup') {
          const procName = draggedNode.id.replace(/^proc_/, '');
          const proc = (proj.processes || []).find((p) => p.name === procName);
          const oldOrigin = parentOrigins[draggedNode.id] || { x: 0, y: 0 };
          const dx = Math.round(draggedNode.position.x - oldOrigin.x);
          const dy = Math.round(draggedNode.position.y - oldOrigin.y);
          proj.view.subPos[draggedNode.id] = {
            x: Math.round(draggedNode.position.x),
            y: Math.round(draggedNode.position.y),
          };
          if (proc && (dx !== 0 || dy !== 0)) {
            for (const n of proj.nodes || []) {
              if (!n.subRef && (proc.nodes || []).includes(n.label)) {
                n.x = Math.round((n.x ?? 80) + dx);
                n.y = Math.round((n.y ?? 80) + dy);
              }
            }
          }
          return;
        }

        if (draggedNode.type === 'subsystemNode') {
          const subRef = draggedNode.id.replace(/^sub_/, '');
          const sub = (proj.subSystems || []).find((s) => s.ref === subRef);
          const oldOrigin = parentOrigins[draggedNode.id] || { x: sub?.x || 0, y: sub?.y || 0 };
          const dx = Math.round(draggedNode.position.x - oldOrigin.x);
          const dy = Math.round(draggedNode.position.y - oldOrigin.y);
          const newPos = {
            x: Math.round(draggedNode.position.x),
            y: Math.round(draggedNode.position.y),
          };
          if (sub) {
            sub.x = newPos.x;
            sub.y = newPos.y;
          }
          proj.view.subPos[subRef] = newPos;
          for (const m of proj.nodes || []) {
            if (m.subRef === subRef) {
              m.x = Math.round((m.x ?? oldOrigin.x + PAD_X) + dx);
              m.y = Math.round((m.y ?? oldOrigin.y + PAD_TOP) + dy);
            }
          }
          return;
        }

        if (draggedNode.type === 'rosNode') {
          const target = (proj.nodes || []).find((n) => n.id === draggedNode.id);
          if (!target) return;
          target.x = Math.round(draggedNode.position.x);
          target.y = Math.round(draggedNode.position.y);
        }
      });
    },
    [isReadOnly, parentOrigins]
  );

  const isValidConnection = useCallback(
    (conn) => {
      if (isReadOnly) return false;
      const src = resolveHandleEndpoint(conn.source, conn.sourceHandle, project);
      const tgt = resolveHandleEndpoint(conn.target, conn.targetHandle, project);
      const res = validatePortConnection(
        src.node,
        src.iface,
        tgt.node,
        tgt.iface,
        project.connections || []
      );
      return res.valid;
    },
    [isReadOnly, project]
  );

  const onConnect = useCallback(
    (conn) => {
      if (isReadOnly) return;
      const src = resolveHandleEndpoint(conn.source, conn.sourceHandle, project);
      const tgt = resolveHandleEndpoint(conn.target, conn.targetHandle, project);
      const res = validatePortConnection(
        src.node,
        src.iface,
        tgt.node,
        tgt.iface,
        project.connections || []
      );
      if (!res.valid || !res.normalizedFrom || !res.normalizedTo) {
        showToast(res.reason || 'Incompatible ports', true);
        return;
      }

      const newConnId = `c_${res.normalizedFrom.i}_${res.normalizedTo.i}_${Date.now().toString(36)}`;
      mutateProject((proj) => {
        if (!proj.connections) proj.connections = [];
        proj.connections.push({
          id: newConnId,
          from: { n: res.normalizedFrom.n, i: res.normalizedFrom.i },
          to: { n: res.normalizedTo.n, i: res.normalizedTo.i },
        });
      });
      setUIState({
        selectedEdgeId: newConnId,
        selectedNodeId: null,
        selectedSubsystemRef: null,
        selectedProcessName: null,
      });
    },
    [isReadOnly, project]
  );

  const onConnectEnd = useCallback(
    (_, connectionState) => {
      if (isReadOnly) return;
      if (connectionState?.toHandle && !connectionState.isValid && connectionState.fromHandle) {
        const src = resolveHandleEndpoint(
          connectionState.fromNode?.id,
          connectionState.fromHandle.id,
          project
        );
        const tgt = resolveHandleEndpoint(
          connectionState.toNode?.id,
          connectionState.toHandle.id,
          project
        );
        const res = validatePortConnection(
          src.node,
          src.iface,
          tgt.node,
          tgt.iface,
          project.connections || []
        );
        if (!res.valid && res.reason) {
          showToast(res.reason, true);
        }
      }
    },
    [isReadOnly, project]
  );

  const onNodesDelete = useCallback(
    (deleted) => {
      if (isReadOnly || !deleted?.length) return;
      mutateProject((proj) => {
        for (const dn of deleted) {
          if (dn.type === 'processGroup') {
            const pName = dn.id.replace(/^proc_/, '');
            proj.processes = (proj.processes || []).filter((p) => p.name !== pName);
          } else if (dn.type === 'subsystemNode') {
            const sRef = dn.id.replace(/^sub_/, '');
            const subMemberIds = new Set(
              (proj.nodes || []).filter((n) => n.subRef === sRef).map((n) => n.id)
            );
            proj.subSystems = (proj.subSystems || []).filter((s) => s.ref !== sRef);
            proj.nodes = (proj.nodes || []).filter((n) => n.subRef !== sRef);
            proj.connections = (proj.connections || []).filter(
              (c) => !subMemberIds.has(c.from.n) && !subMemberIds.has(c.to.n)
            );
          } else if (dn.type === 'rosNode') {
            const targetNode = (proj.nodes || []).find((n) => n.id === dn.id);
            if (targetNode?.subRef) continue; // Do not delete internal subsystem contract nodes individually
            proj.nodes = (proj.nodes || []).filter((n) => n.id !== dn.id);
            proj.connections = (proj.connections || []).filter(
              (c) => c.from.n !== dn.id && c.to.n !== dn.id
            );
            if (targetNode) {
              for (const proc of proj.processes || []) {
                proc.nodes = (proc.nodes || []).filter((nl) => nl !== targetNode.label);
              }
            }
          }
        }
      });
      setUIState({
        selectedNodeId: null,
        selectedEdgeId: null,
        selectedSubsystemRef: null,
        selectedProcessName: null,
      });
    },
    [isReadOnly]
  );

  const onEdgesDelete = useCallback(
    (deletedEdges) => {
      if (isReadOnly || !deletedEdges?.length) return;
      const ids = new Set(deletedEdges.map((e) => e.id));
      mutateProject((proj) => {
        proj.connections = (proj.connections || []).filter((c) => !ids.has(c.id));
      });
      setUIState({ selectedEdgeId: null });
    },
    [isReadOnly]
  );

  const handleDrop = useCallback(
    (e) => {
      e.preventDefault();
      if (isReadOnly) return;
      const raw = e.dataTransfer.getData('application/rostooling-node');
      if (!raw) return;
      try {
        const { key, entry } = JSON.parse(raw);
        const pos = rfInstance.screenToFlowPosition({ x: e.clientX, y: e.clientY });
        importCatalogueNode(key, entry, pos);
      } catch {
        // ignore invalid payload
      }
    },
    [isReadOnly, rfInstance]
  );

  const isEmpty =
    (project.nodes || []).filter((n) => !n.subRef).length === 0 &&
    (project.subSystems || []).length === 0 &&
    (project.processes || []).length === 0;

  return (
    <div className="rt-canvas-stage">
      {/* Canvas Sub-Toolbar: Search + Legend */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          padding: '6px 12px',
          borderBottom: '1px solid var(--rt-border)',
          background: 'var(--rt-surface)',
          fontSize: 11.5,
        }}
      >
        <div className="rt-search-box" style={{ width: 240 }}>
          <Search size={13} />
          <input
            placeholder="Filter canvas nodes or topics..."
            value={canvasSearch}
            onChange={(e) => setCanvasSearch(e.target.value)}
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--rt-muted)', flexWrap: 'wrap' }}>
          {Object.entries(KIND_META).map(([k, m]) => (
            <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: m.color,
                  display: 'inline-block',
                }}
              />
              {m.short}
            </span>
          ))}
        </div>
      </div>

      <div
        className="rt-flow-wrapper"
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }}
        onDrop={handleDrop}
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          edgeTypes={EDGE_TYPES}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeDragStop={onNodeDragStop}
          onConnect={onConnect}
          isValidConnection={isValidConnection}
          onConnectEnd={onConnectEnd}
          onNodesDelete={onNodesDelete}
          onEdgesDelete={onEdgesDelete}
          onNodeClick={(_, rfNode) => {
            if (rfNode.type === 'processGroup') {
              setUIState({
                selectedProcessName: rfNode.id.replace(/^proc_/, ''),
                selectedNodeId: null,
                selectedEdgeId: null,
                selectedSubsystemRef: null,
              });
            } else if (rfNode.type === 'subsystemNode') {
              setUIState({
                selectedSubsystemRef: rfNode.id.replace(/^sub_/, ''),
                selectedNodeId: null,
                selectedEdgeId: null,
                selectedProcessName: null,
              });
            } else {
              setUIState({
                selectedNodeId: rfNode.id,
                selectedEdgeId: null,
                selectedSubsystemRef: null,
                selectedProcessName: null,
              });
            }
          }}
          onEdgeClick={(_, edge) => {
            setUIState({
              selectedEdgeId: edge.id,
              selectedNodeId: null,
              selectedSubsystemRef: null,
              selectedProcessName: null,
            });
          }}
          onPaneClick={() => {
            setUIState({
              selectedNodeId: null,
              selectedEdgeId: null,
              selectedSubsystemRef: null,
              selectedProcessName: null,
            });
          }}
          onMoveEnd={(_, viewport) => {
            if (isReadOnly || !viewport) return;
            mutateLayout((proj) => {
              if (!proj.view) proj.view = {};
              proj.view.tx = Math.round(viewport.x);
              proj.view.ty = Math.round(viewport.y);
              proj.view.k = Number(viewport.zoom.toFixed(3));
            });
          }}
          nodesConnectable={!isReadOnly}
          nodesDraggable={!isReadOnly}
          deleteKeyCode={isReadOnly ? [] : ['Backspace', 'Delete']}
          elementsSelectable={true}
          fitView
          fitViewOptions={{ padding: 0.18, maxZoom: 1.05 }}
          minZoom={0.18}
          maxZoom={2.2}
          connectionRadius={26}
        >
          <Background gap={22} size={1} color="rgba(148, 163, 184, 0.22)" />
          <Controls showInteractive={false} />
          <MiniMap
            pannable
            zoomable
            nodeColor={(n) =>
              n.type === 'processGroup'
                ? 'rgba(56, 189, 248, 0.35)'
                : n.type === 'subsystemNode'
                ? '#f59e0b'
                : '#3b82f6'
            }
          />
        </ReactFlow>

        {isEmpty && (
          <div className="rt-canvas-empty">
            <Box size={28} style={{ color: '#60a5fa', marginBottom: 8 }} />
            <h3 style={{ margin: '0 0 6px', fontSize: 15 }}>Assemble ROS 2 System Architecture</h3>
            <p style={{ margin: '0 0 14px', fontSize: 12, color: 'var(--rt-muted)' }}>
              Import verified component contracts (`.ros2`) or subsystems (`.rossystem`) from the catalogue, wire ports, and group nodes into `ComposableNodeContainer` processes.
            </p>
            {!isReadOnly && (
              <div style={{ display: 'flex', justifyContent: 'center', gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="rt-btn primary"
                  onClick={() => setUIState({ catalogueOpen: true, catalogueTab: 'nodes' })}
                >
                  <Plus size={14} /> Import Node
                </button>
                <button
                  type="button"
                  className="rt-btn"
                  onClick={() => setUIState({ catalogueOpen: true, catalogueTab: 'systems' })}
                >
                  <Layers size={14} /> Import Subsystem
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function SystemInspector() {
  const studio = useStudio();
  const {
    project,
    isReadOnly,
    selectedNodeId,
    selectedEdgeId,
    selectedSubsystemRef,
    selectedProcessName,
  } = studio;

  const selectedEdge = (project.connections || []).find((c) => c.id === selectedEdgeId);
  const selectedNode = (project.nodes || []).find((n) => n.id === selectedNodeId);
  const selectedSub = (project.subSystems || []).find((s) => s.ref === selectedSubsystemRef);
  const selectedProc = (project.processes || []).find((p) => p.name === selectedProcessName);

  // 1. Connection Inspector
  if (selectedEdge) {
    const fromNode = (project.nodes || []).find((n) => n.id === selectedEdge.from.n);
    const toNode = (project.nodes || []).find((n) => n.id === selectedEdge.to.n);
    const fromIface = (fromNode?.ifaces || []).find(
      (f) => f.id === selectedEdge.from.i || f.label === selectedEdge.from.i || f.name === selectedEdge.from.i
    );
    const toIface = (toNode?.ifaces || []).find(
      (f) => f.id === selectedEdge.to.i || f.label === selectedEdge.to.i || f.name === selectedEdge.to.i
    );
    const resolvedType = fromIface?.type || toIface?.type || 'Unspecified';

    return (
      <aside className="rt-inspector-right">
        <div className="rt-panel-pad">
          <div className="rt-section-hdr">
            <h2>Connection Inspector</h2>
          </div>
          <div
            style={{
              padding: 12,
              borderRadius: 6,
              background: 'var(--rt-surface-2)',
              border: '1px solid var(--rt-border)',
              marginBottom: 14,
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 12.5 }}>{fromNode?.label || selectedEdge.from.n}</div>
            <div style={{ fontSize: 11.5, color: 'var(--k-pub)', fontFamily: 'var(--rt-mono)' }}>
              {fromIface?.label || fromIface?.name || selectedEdge.from.i} ({fromIface?.kind || 'src'})
            </div>
            <div style={{ margin: '8px 0', color: 'var(--rt-muted)' }}>
              <ArrowRight size={15} />
            </div>
            <div style={{ fontWeight: 700, fontSize: 12.5 }}>{toNode?.label || selectedEdge.to.n}</div>
            <div style={{ fontSize: 11.5, color: 'var(--k-sub)', fontFamily: 'var(--rt-mono)' }}>
              {toIface?.label || toIface?.name || selectedEdge.to.i} ({toIface?.kind || 'dst'})
            </div>
          </div>

          <div className="rt-field">
            <label>Resolved ROS Type</label>
            <input className="rt-input" readOnly value={resolvedType} />
          </div>

          <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
            {fromNode && (
              <button
                type="button"
                className="rt-btn"
                onClick={() => setUIState({ selectedNodeId: fromNode.id, selectedEdgeId: null })}
              >
                Inspect Source
              </button>
            )}
            {toNode && (
              <button
                type="button"
                className="rt-btn"
                onClick={() => setUIState({ selectedNodeId: toNode.id, selectedEdgeId: null })}
              >
                Inspect Target
              </button>
            )}
          </div>

          {!isReadOnly && (
            <button
              type="button"
              className="rt-btn danger"
              style={{ width: '100%' }}
              onClick={() => {
                mutateProject((proj) => {
                  proj.connections = (proj.connections || []).filter((c) => c.id !== selectedEdge.id);
                });
                setUIState({ selectedEdgeId: null });
              }}
            >
              <Unplug size={14} /> Disconnect Wire
            </button>
          )}
        </div>
      </aside>
    );
  }

  // 2. Subsystem Inspector
  if (selectedSub) {
    const subMembers = (project.nodes || []).filter((n) => n.subRef === selectedSub.ref);
    const curState = project.view?.subStates?.[selectedSub.ref] || selectedSub.state || 'collapsed';

    return (
      <aside className="rt-inspector-right">
        <div className="rt-panel-pad">
          <div className="rt-section-hdr">
            <h2>
              <Layers size={15} style={{ color: '#fbbf24' }} /> Subsystem Inspector
            </h2>
          </div>

          <div className="rt-field">
            <label>Subsystem Reference</label>
            <input className="rt-input" readOnly value={selectedSub.ref} />
          </div>

          <div className="rt-field">
            <label>Source File</label>
            <input
              className="rt-input"
              readOnly
              value={selectedSub.fromFile || `${selectedSub.ref}.rossystem`}
            />
          </div>

          <div className="rt-field">
            <label>Canvas Presentation</label>
            <select
              className="rt-select"
              disabled={isReadOnly}
              value={curState}
              onChange={(e) => {
                const nextState = e.target.value;
                mutateLayout((proj) => {
                  if (!proj.view) proj.view = {};
                  if (!proj.view.subStates) proj.view.subStates = {};
                  proj.view.subStates[selectedSub.ref] = nextState;
                  const s = (proj.subSystems || []).find((x) => x.ref === selectedSub.ref);
                  if (s) s.state = nextState;
                });
              }}
            >
              <option value="collapsed">Collapsed Card (Aggregated Ports)</option>
              <option value="framed">Expanded Frame (Show Internal Nodes)</option>
            </select>
          </div>

          <button
            id="btnOpenSubsystemRosSystem"
            type="button"
            className="rt-btn primary"
            style={{ width: '100%', marginBottom: 12 }}
            onClick={() =>
              hostBridge.openSubsystemRosSystem({
                subRef: selectedSub.ref,
                fromFile: selectedSub.fromFile,
              })
            }
          >
            📦 Edit Subsystem in .rossystem View
          </button>

          <div className="rt-section-hdr">
            <h3>Internal Nodes ({subMembers.length})</h3>
          </div>
          {subMembers.map((m) => (
            <button
              key={m.id}
              type="button"
              className="rt-node-list-item"
              onClick={() => setUIState({ selectedNodeId: m.id, selectedSubsystemRef: null })}
            >
              <div>
                <strong style={{ display: 'block', fontSize: 12 }}>{m.label}</strong>
                <small style={{ color: 'var(--rt-muted)', fontFamily: 'var(--rt-mono)' }}>
                  {m.from || m.pkg}
                </small>
              </div>
              <span className="rt-badge ns">{(m.ifaces || []).length} ports</span>
            </button>
          ))}

          {!isReadOnly && (
            <button
              type="button"
              className="rt-btn danger"
              style={{ width: '100%', marginTop: 14 }}
              onClick={() => {
                mutateProject((proj) => {
                  const memberIds = new Set(
                    (proj.nodes || []).filter((n) => n.subRef === selectedSub.ref).map((n) => n.id)
                  );
                  proj.subSystems = (proj.subSystems || []).filter((s) => s.ref !== selectedSub.ref);
                  proj.nodes = (proj.nodes || []).filter((n) => n.subRef !== selectedSub.ref);
                  proj.connections = (proj.connections || []).filter(
                    (c) => !memberIds.has(c.from.n) && !memberIds.has(c.to.n)
                  );
                });
                setUIState({ selectedSubsystemRef: null });
              }}
            >
              <Trash2 size={14} /> Remove Subsystem
            </button>
          )}
        </div>
      </aside>
    );
  }

  // 3. Process Container Inspector
  if (selectedProc) {
    const directNodes = (project.nodes || []).filter((n) => !n.subRef && n.backing !== 'sub');

    return (
      <aside className="rt-inspector-right">
        <div className="rt-panel-pad">
          <div className="rt-section-hdr">
            <h2>
              <Cpu size={15} style={{ color: '#38bdf8' }} /> Process Container
            </h2>
          </div>

          <div className="rt-field">
            <label>Container Name (`ComposableNodeContainer`)</label>
            <input
              className="rt-input"
              disabled={isReadOnly}
              value={selectedProc.name}
              onChange={(e) => {
                const newName = e.target.value.trim();
                if (!newName) return;
                mutateProject((proj) => {
                  const p = (proj.processes || []).find((x) => x.name === selectedProc.name);
                  if (p) p.name = newName;
                });
                setUIState({ selectedProcessName: newName });
              }}
            />
          </div>

          <div className="rt-field">
            <label>Executor Threads (`threads`)</label>
            <input
              type="number"
              min="1"
              max="64"
              className="rt-input"
              disabled={isReadOnly}
              value={selectedProc.threads ?? 1}
              onChange={(e) => {
                const threads = Math.max(1, parseInt(e.target.value || '1', 10) || 1);
                mutateProject((proj) => {
                  const p = (proj.processes || []).find((x) => x.name === selectedProc.name);
                  if (p) p.threads = threads;
                });
              }}
            />
          </div>

          <div className="rt-section-hdr">
            <h3>Assigned System Nodes ({(selectedProc.nodes || []).length})</h3>
          </div>
          {directNodes.length === 0 ? (
            <p style={{ fontSize: 12, color: 'var(--rt-muted)' }}>
              Import system nodes onto the canvas first to assign them to this process container.
            </p>
          ) : (
            directNodes.map((n) => {
              const checked = (selectedProc.nodes || []).includes(n.label);
              return (
                <label
                  key={n.id}
                  className="rt-cat-item"
                  style={{ cursor: isReadOnly ? 'default' : 'pointer' }}
                >
                  <div>
                    <strong style={{ display: 'block', fontSize: 12 }}>{n.label}</strong>
                    <small style={{ color: 'var(--rt-muted)', fontFamily: 'var(--rt-mono)' }}>
                      {n.from}
                    </small>
                  </div>
                  <input
                    type="checkbox"
                    disabled={isReadOnly}
                    checked={checked}
                    onChange={(e) => {
                      const shouldAssign = e.target.checked;
                      mutateProject((proj) => {
                        for (const p of proj.processes || []) {
                          if (p.name === selectedProc.name) {
                            const set = new Set(p.nodes || []);
                            if (shouldAssign) set.add(n.label);
                            else set.delete(n.label);
                            p.nodes = Array.from(set);
                          } else if (shouldAssign) {
                            // Ensure a node belongs to only one container
                            p.nodes = (p.nodes || []).filter((nl) => nl !== n.label);
                          }
                        }
                      });
                    }}
                  />
                </label>
              );
            })
          )}

          {!isReadOnly && (
            <button
              type="button"
              className="rt-btn danger"
              style={{ width: '100%', marginTop: 14 }}
              onClick={() => {
                mutateProject((proj) => {
                  proj.processes = (proj.processes || []).filter((p) => p.name !== selectedProc.name);
                });
                setUIState({ selectedProcessName: null });
              }}
            >
              <Trash2 size={14} /> Delete Process Container
            </button>
          )}
        </div>
      </aside>
    );
  }

  // 4. System Node Inspector
  if (selectedNode) {
    const isSubMember = Boolean(selectedNode.subRef) || selectedNode.backing === 'sub';
    const nodeReadOnly = isReadOnly || isSubMember;
    const currentProcess = (project.processes || []).find((p) =>
      (p.nodes || []).includes(selectedNode.label)
    );
    const parentSub = selectedNode.subRef
      ? (project.subSystems || []).find((s) => s.ref === selectedNode.subRef)
      : null;

    return (
      <aside className="rt-inspector-right">
        <div className="rt-panel-pad">
          <div className="rt-section-hdr">
            <h2>
              <Box size={15} style={{ color: '#60a5fa' }} /> System Node Inspector
            </h2>
            {selectedNode.isLifecycle && (
              <span className="rt-badge lifecycle">
                <Activity size={10} /> Lifecycle
              </span>
            )}
          </div>

          {isSubMember && (
            <div style={{ marginBottom: 12 }}>
              <button
                id="btnOpenParentSubsystemRosSystem"
                type="button"
                className="rt-btn"
                style={{ width: '100%' }}
                onClick={() =>
                  hostBridge.openSubsystemRosSystem({
                    subRef: selectedNode.subRef,
                    fromFile: parentSub?.fromFile,
                  })
                }
              >
                📦 Edit Subsystem ({selectedNode.subRef})
              </button>
            </div>
          )}

          <div className="rt-field">
            <label>Instance Name (`label`)</label>
            <input
              className="rt-input"
              disabled={nodeReadOnly}
              value={selectedNode.label}
              onChange={(e) => updateNodeLabel(selectedNode.id, e.target.value)}
            />
            <small>Renames this system instance without altering its `.ros2` component contract.</small>
          </div>

          <div className="rt-field">
            <label>Namespace (`namespace`)</label>
            <input
              className="rt-input"
              disabled={nodeReadOnly}
              placeholder="/robot_ns"
              value={selectedNode.namespace || ''}
              onChange={(e) => {
                const ns = e.target.value;
                mutateProject((proj) => {
                  const n = (proj.nodes || []).find((x) => x.id === selectedNode.id);
                  if (n) n.namespace = ns || undefined;
                });
              }}
            />
          </div>

          <div className="rt-field">
            <label>Component Contract (`from` — Read-Only)</label>
            <input
              id="inpNodeFrom"
              className="rt-input"
              readOnly
              value={selectedNode.from || `${selectedNode.pkg || ''}.${selectedNode.artifact || selectedNode.label}`}
            />
          </div>

          <button
            id="btnOpenComponentRos2"
            type="button"
            className="rt-btn primary"
            style={{ width: '100%', marginBottom: 14 }}
            onClick={() =>
              hostBridge.openComponentRos2({
                from: selectedNode.from,
                pkg: selectedNode.pkg,
                artifact: selectedNode.artifact,
                label: selectedNode.label,
              })
            }
          >
            <ExternalLink size={13} /> Edit Component in .ros2 View
          </button>

          {!isSubMember && (project.processes || []).length > 0 && (
            <div className="rt-field">
              <label>Composable Process Container</label>
              <select
                className="rt-select"
                disabled={nodeReadOnly}
                value={currentProcess?.name || ''}
                onChange={(e) => {
                  const targetProc = e.target.value;
                  mutateProject((proj) => {
                    for (const p of proj.processes || []) {
                      p.nodes = (p.nodes || []).filter((nl) => nl !== selectedNode.label);
                      if (p.name === targetProc) {
                        p.nodes.push(selectedNode.label);
                      }
                    }
                  });
                }}
              >
                <option value="">Standalone OS Process</option>
                {(project.processes || []).map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.name} ({p.threads ?? 1} threads)
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Interfaces & Remapping */}
          <div className="rt-section-hdr">
            <h3>Interfaces & Remapping ({(selectedNode.ifaces || []).length})</h3>
          </div>
          {(selectedNode.ifaces || []).length === 0 ? (
            <p style={{ fontSize: 12, color: 'var(--rt-muted)' }}>No interfaces declared on component.</p>
          ) : (
            (selectedNode.ifaces || []).map((iface) => {
              const meta = KIND_META[iface.kind] || { short: iface.kind };
              return (
                <div key={iface.id} className="rt-iface-card">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                    <label className="rt-checkbox-row">
                      <input
                        type="checkbox"
                        disabled={nodeReadOnly}
                        checked={iface.exposed !== false}
                        onChange={(e) => {
                          const exposed = e.target.checked;
                          mutateProject((proj) => {
                            const n = (proj.nodes || []).find((x) => x.id === selectedNode.id);
                            const f = (n?.ifaces || []).find((x) => x.id === iface.id);
                            if (f) f.exposed = exposed;
                          });
                        }}
                      />
                      <span className={`rt-port-kind ${iface.kind}`}>{meta.short}</span>
                      <strong style={{ fontSize: 12 }}>{iface.name}</strong>
                    </label>
                    <small style={{ color: 'var(--rt-muted)', fontFamily: 'var(--rt-mono)', fontSize: 10 }}>
                      {iface.type ? iface.type.split('/').pop() : 'untyped'}
                    </small>
                  </div>
                  <div className="rt-field" style={{ marginBottom: 0 }}>
                    <label>Remapped Topic / Service / Action Name</label>
                    <input
                      className="rt-input inp-iface-remap"
                      disabled={nodeReadOnly || iface.exposed === false}
                      value={iface.label ?? iface.name}
                      placeholder={iface.name}
                      onChange={(e) => {
                        const remapped = e.target.value;
                        mutateProject((proj) => {
                          const n = (proj.nodes || []).find((x) => x.id === selectedNode.id);
                          const f = (n?.ifaces || []).find((x) => x.id === iface.id);
                          if (f) f.label = remapped;
                        });
                      }}
                    />
                  </div>
                </div>
              );
            })
          )}

          {/* Parameters Launch Overrides */}
          <div className="rt-section-hdr">
            <h3>Parameter Overrides ({(selectedNode.params || []).length})</h3>
          </div>
          {(selectedNode.params || []).length === 0 ? (
            <p style={{ fontSize: 12, color: 'var(--rt-muted)' }}>No parameters declared on component.</p>
          ) : (
            (selectedNode.params || []).map((param) => {
              const isConfigured = param.exposed !== false && (param.sysValue !== undefined || param.value !== undefined);
              return (
                <div key={param.id || param.name} className="rt-iface-card">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                    <label className="rt-checkbox-row">
                      <input
                        type="checkbox"
                        disabled={nodeReadOnly}
                        checked={Boolean(isConfigured && param.exposed !== false)}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          mutateProject((proj) => {
                            const n = (proj.nodes || []).find((x) => x.id === selectedNode.id);
                            const p = (n?.params || []).find((x) => x.name === param.name);
                            if (p) {
                              p.exposed = checked;
                              if (checked && (p.sysValue === undefined || p.sysValue === '')) {
                                p.sysValue = p.value !== undefined ? p.value : (p.ptype === 'Boolean' ? 'false' : p.ptype === 'Integer' ? '0' : p.ptype === 'Double' ? '0.0' : '');
                              }
                            }
                          });
                        }}
                      />
                      <strong style={{ fontSize: 12 }}>{param.name}</strong>
                    </label>
                    <span className="rt-badge ns">{param.ptype || 'String'}</span>
                  </div>
                  {param.exposed !== false && (
                    <div className="rt-field" style={{ marginBottom: 0 }}>
                      <label>
                        Launch Value
                        {param.value !== undefined && <span>Default: {String(param.value)}</span>}
                      </label>
                      <input
                        className="rt-input"
                        disabled={nodeReadOnly}
                        value={param.sysValue !== undefined ? String(param.sysValue) : (param.value !== undefined ? String(param.value) : '')}
                        placeholder="Enter launch override value..."
                        onChange={(e) => {
                          const val = e.target.value;
                          mutateProject((proj) => {
                            const n = (proj.nodes || []).find((x) => x.id === selectedNode.id);
                            const p = (n?.params || []).find((x) => x.name === param.name);
                            if (p) {
                              p.exposed = true;
                              p.sysValue = val;
                            }
                          });
                        }}
                      />
                    </div>
                  )}
                </div>
              );
            })
          )}

          {!nodeReadOnly && (
            <button
              type="button"
              className="rt-btn danger"
              style={{ width: '100%', marginTop: 14 }}
              onClick={() => {
                mutateProject((proj) => {
                  proj.nodes = (proj.nodes || []).filter((n) => n.id !== selectedNode.id);
                  proj.connections = (proj.connections || []).filter(
                    (c) => c.from.n !== selectedNode.id && c.to.n !== selectedNode.id
                  );
                  for (const proc of proj.processes || []) {
                    proc.nodes = (proc.nodes || []).filter((nl) => nl !== selectedNode.label);
                  }
                });
                setUIState({ selectedNodeId: null });
              }}
            >
              <Trash2 size={14} /> Remove Node from System
            </button>
          )}
        </div>
      </aside>
    );
  }

  // 5. Default System Overview (Subsystems + Processes + Diagnostics)
  const directNodes = (project.nodes || []).filter((n) => !n.subRef && n.backing !== 'sub');
  const processes = project.processes || [];
  const subSystems = project.subSystems || [];
  const diags = project.diagnostics || [];

  return (
    <aside className="rt-inspector-right">
      <div className="rt-panel-pad">
        <div className="rt-section-hdr">
          <h2>System Overview</h2>
        </div>
        <p style={{ fontSize: 12, color: 'var(--rt-muted)', marginTop: 0 }}>
          Click any node, wire, subsystem, or process container on the canvas to inspect and edit its configuration.
        </p>

        {/* Processes Section */}
        <section id="processSection" style={{ marginBottom: 18 }}>
          <div className="rt-section-hdr">
            <h3>
              <Cpu size={14} style={{ color: '#38bdf8' }} /> Processes ({processes.length})
            </h3>
            {!isReadOnly && (
              <button
                type="button"
                className="rt-btn"
                onClick={() => {
                  let newProcName = 'container_1';
                  mutateProject((proj) => {
                    if (!proj.processes) proj.processes = [];
                    let idx = proj.processes.length + 1;
                    newProcName = `container_${idx}`;
                    while (proj.processes.some((p) => p.name === newProcName)) {
                      idx += 1;
                      newProcName = `container_${idx}`;
                    }
                    proj.processes.push({
                      name: newProcName,
                      nodes: [],
                      threads: 2,
                    });
                  });
                  setUIState({ selectedProcessName: newProcName });
                }}
              >
                <Plus size={12} /> Add Process
              </button>
            )}
          </div>
          {processes.length === 0 ? (
            <small style={{ color: 'var(--rt-muted)' }}>
              No `ComposableNodeContainer` processes configured. Nodes launch as standalone OS processes.
            </small>
          ) : (
            processes.map((proc) => (
              <button
                key={proc.name}
                type="button"
                className="rt-node-list-item"
                onClick={() => setUIState({ selectedProcessName: proc.name })}
              >
                <div>
                  <strong style={{ display: 'block', fontSize: 12 }}>{proc.name}</strong>
                  <small style={{ color: 'var(--rt-muted)' }}>
                    {(proc.nodes || []).length} nodes · {proc.threads ?? 1} threads
                  </small>
                </div>
                <span className="rt-badge ns">Container</span>
              </button>
            ))
          )}
        </section>

        {/* Subsystems Section */}
        <section id="subsystemSection" style={{ marginBottom: 18 }}>
          <div className="rt-section-hdr">
            <h3>
              <Layers size={14} style={{ color: '#fbbf24' }} /> Subsystems ({subSystems.length})
            </h3>
            {!isReadOnly && (
              <button
                type="button"
                className="rt-btn"
                onClick={() => setUIState({ catalogueOpen: true, catalogueTab: 'systems' })}
              >
                <Plus size={12} /> Import
              </button>
            )}
          </div>
          {subSystems.length === 0 ? (
            <small style={{ color: 'var(--rt-muted)' }}>No child `.rossystem` subsystems imported.</small>
          ) : (
            subSystems.map((s) => (
              <button
                key={s.ref}
                type="button"
                className="rt-node-list-item"
                onClick={() => setUIState({ selectedSubsystemRef: s.ref })}
              >
                <div>
                  <strong style={{ display: 'block', fontSize: 12 }}>{s.ref}</strong>
                  <small style={{ color: 'var(--rt-muted)', fontFamily: 'var(--rt-mono)' }}>
                    {s.fromFile || `${s.ref}.rossystem`}
                  </small>
                </div>
                <span className="rt-badge ns">{s.state || 'collapsed'}</span>
              </button>
            ))
          )}
        </section>

        {/* Nodes Quick List */}
        <section style={{ marginBottom: 18 }}>
          <div className="rt-section-hdr">
            <h3>
              <Box size={14} style={{ color: '#60a5fa' }} /> System Nodes ({directNodes.length})
            </h3>
          </div>
          {directNodes.map((n) => (
            <button
              key={n.id}
              type="button"
              className="rt-node-list-item"
              onClick={() => setUIState({ selectedNodeId: n.id })}
            >
              <div style={{ minWidth: 0 }}>
                <strong style={{ display: 'block', fontSize: 12 }}>{n.label}</strong>
                <small style={{ color: 'var(--rt-muted)', fontFamily: 'var(--rt-mono)' }}>
                  {n.from}
                </small>
              </div>
              {n.isLifecycle && <span className="rt-badge lifecycle">LC</span>}
            </button>
          ))}
        </section>

        {diags.length > 0 && (
          <section>
            <div className="rt-section-hdr">
              <h3>
                <AlertCircle size={14} style={{ color: 'var(--rt-err)' }} /> Active Diagnostics ({diags.length})
              </h3>
            </div>
            {diags.map((d, i) => (
              <div key={i} className="rt-diag-item">
                <span className={`rt-badge ${d.severity === 'error' ? 'diag-err' : 'diag-warn'}`}>
                  {d.severity}
                </span>
                <div>
                  <strong style={{ display: 'block', fontSize: 11.5 }}>{d.targetName || d.elementKind}</strong>
                  <span style={{ color: 'var(--rt-muted)' }}>{d.message}</span>
                </div>
              </div>
            ))}
          </section>
        )}
      </div>
    </aside>
  );
}

export function RosSystemView() {
  return (
    <div className="rt-workbench">
      <ReactFlowProvider>
        <SystemCanvasInner />
        <SystemInspector />
      </ReactFlowProvider>
    </div>
  );
}
