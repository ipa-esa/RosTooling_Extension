import React, { useMemo, useEffect } from 'react';
import { BaseEdge, EdgeLabelRenderer, useReactFlow, useViewport } from '@xyflow/react';
import { computeLiveOrthogonalEdge, unregisterEdgeVerticals } from '../state/orthogonalRouter';

export function JumpOrthogonalEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  style,
  markerEnd,
  label,
  selected,
  data,
}) {
  const reactFlow = useReactFlow();
  const viewport = useViewport();

  const isReadOnly = Boolean(data?.isReadOnly);
  const midX = data?.midX;
  const midY = data?.midY;
  const waypoints = data?.waypoints || [];

  const {
    pathD,
    pts,
    handleV,
    handleH,
    handleWaypoints,
  } = useMemo(() => {
    return computeLiveOrthogonalEdge({
      id,
      sourceX,
      sourceY,
      targetX,
      targetY,
      midX,
      midY,
      waypoints,
    });
  }, [id, sourceX, sourceY, targetX, targetY, midX, midY, waypoints]);

  useEffect(() => {
    return () => {
      unregisterEdgeVerticals(id);
    };
  }, [id]);

  // Label position: placed along a horizontal segment away from drag handles (handleV, handleH, waypoints)
  let labelX = (sourceX + targetX) / 2;
  let labelY = (sourceY + targetY) / 2;

  if (pts && pts.length >= 2) {
    const handles = [handleV, handleH, ...(handleWaypoints || [])].filter(Boolean);

    const distToHandles = (x, y) => {
      if (handles.length === 0) return 999;
      return Math.min(...handles.map((h) => Math.hypot(x - h.x, y - h.y)));
    };

    // Collect all horizontal segments
    const horizSegments = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const p1 = pts[i];
      const p2 = pts[i + 1];
      if (Math.abs(p1.y - p2.y) < 2) {
        const len = Math.abs(p2.x - p1.x);
        horizSegments.push({ p1, p2, len, y: p1.y });
      }
    }

    if (horizSegments.length > 0) {
      // Generate candidate label positions along horizontal segments
      const candidates = [];

      // 1. Midpoint of first horizontal segment (source towards corridor) - natural for ROS port labels
      const first = horizSegments[0];
      candidates.push({
        x: (first.p1.x + first.p2.x) / 2,
        y: first.y,
        pref: 15,
      });

      // 2. Midpoint of last horizontal segment (corridor towards target)
      if (horizSegments.length > 1) {
        const last = horizSegments[horizSegments.length - 1];
        candidates.push({
          x: (last.p1.x + last.p2.x) / 2,
          y: last.y,
          pref: 10,
        });
      }

      // 3. For any longer horizontal segments, test midpoint and quarter points (25% & 75%)
      for (const seg of horizSegments) {
        if (seg.len >= 60) {
          candidates.push({
            x: seg.p1.x * 0.75 + seg.p2.x * 0.25,
            y: seg.y,
            pref: 6,
          });
          candidates.push({
            x: seg.p1.x * 0.25 + seg.p2.x * 0.75,
            y: seg.y,
            pref: 6,
          });
          candidates.push({
            x: (seg.p1.x + seg.p2.x) / 2,
            y: seg.y,
            pref: 2,
          });
        }
      }

      // Pick the best candidate that maximizes distance to handles while maintaining good preference
      let bestCand = null;
      let bestScore = -Infinity;

      for (const cand of candidates) {
        const d = distToHandles(cand.x, cand.y);
        // Strongly penalize if candidate is closer than 32px to any handle
        const handlePenalty = d < 32 ? (32 - d) * 150 : 0;
        const score = Math.min(d, 120) + (cand.pref || 0) - handlePenalty;
        if (score > bestScore) {
          bestScore = score;
          bestCand = cand;
        }
      }

      if (bestCand) {
        labelX = Math.round(bestCand.x);
        labelY = Math.round(bestCand.y);
      }
    }

    // Safety check: if for any reason label is still within 28px of any handle, offset it vertically
    if (distToHandles(labelX, labelY) < 28) {
      labelY -= 16;
    }
  }

  const handlePointerDown = (ev, dir, wpIdx = null) => {
    if (isReadOnly) return;
    ev.stopPropagation();
    ev.preventDefault();
    const startClientX = ev.clientX;
    const startClientY = ev.clientY;
    const zoom = viewport.zoom || 1;
    const startV = handleV ? handleV.x : 0;
    const startH = handleH ? handleH.y : 0;
    const origWp = wpIdx !== null && handleWaypoints[wpIdx] ? { ...handleWaypoints[wpIdx] } : null;

    const onPointerMove = (moveEv) => {
      const dx = (moveEv.clientX - startClientX) / zoom;
      const dy = (moveEv.clientY - startClientY) / zoom;

      if (dir === 'v' && data?.onMoveMidX) {
        data.onMoveMidX(id, Math.round(startV + dx));
      } else if (dir === 'h' && data?.onMoveMidY) {
        data.onMoveMidY(id, Math.round(startH + dy));
      } else if (dir === 'wp' && data?.onMoveWaypoint && origWp) {
        data.onMoveWaypoint(id, wpIdx, Math.round(origWp.x + dx), Math.round(origWp.y + dy));
      }
    };

    const onPointerUp = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      if (data?.onCommitLayout) {
        data.onCommitLayout();
      }
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  };

  const handleDoubleClick = (ev) => {
    if (isReadOnly || !data?.onAddWaypoint) return;
    ev.stopPropagation();
    ev.preventDefault();
    const flowPos = reactFlow.screenToFlowPosition({ x: ev.clientX, y: ev.clientY });
    data.onAddWaypoint(id, flowPos.x, flowPos.y, pts);
  };

  return (
    <>
      {/* 1. Visible Edge with Jump Arcs */}
      <BaseEdge
        id={id}
        path={pathD}
        markerEnd={markerEnd}
        style={{
          ...style,
          strokeWidth: selected ? 3.2 : 2,
        }}
        className={`react-flow__edge-path ${selected ? 'selected' : ''}`}
      />

      {/* 2. Transparent interaction corridor for easier selection & double-click */}
      <path
        d={pathD}
        fill="none"
        stroke="transparent"
        strokeWidth={20}
        style={{ cursor: 'pointer', pointerEvents: 'stroke' }}
        onDoubleClick={handleDoubleClick}
      />

      {/* 3. Edge Label */}
      {label && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: 'all',
              fontSize: 10,
              fontWeight: 600,
              color: '#cbd5e1',
              background: 'rgba(24, 26, 31, 0.88)',
              padding: '2px 6px',
              borderRadius: 4,
              border: '1px solid rgba(255, 255, 255, 0.12)',
              boxShadow: '0 2px 6px rgba(0, 0, 0, 0.35)',
              userSelect: 'none',
            }}
            title={`Connection: ${id}\nInterface: ${label}`}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}

      {/* 4. Draggable Handles (Corridor MidX, MidY & Waypoints) */}
      {!isReadOnly && (
        <g className="rt-edge-handles-group" style={{ pointerEvents: 'auto' }}>
          {/* Vertical corridor handle (midX) */}
          {handleV && (
            <circle
              cx={handleV.x}
              cy={handleV.y}
              r={selected ? 6.5 : 5}
              className={`rt-edge-handle handle-v ${selected ? 'sel' : ''}`}
              title="Drag horizontally to adjust vertical wire corridor"
              onPointerDown={(ev) => handlePointerDown(ev, 'v')}
            />
          )}

          {/* Horizontal wrap-around corridor handle (midY) */}
          {handleH && (
            <circle
              cx={handleH.x}
              cy={handleH.y}
              r={selected ? 6.5 : 5}
              className={`rt-edge-handle handle-h ${selected ? 'sel' : ''}`}
              title="Drag vertically to adjust horizontal wrap corridor"
              onPointerDown={(ev) => handlePointerDown(ev, 'h')}
            />
          )}

          {/* Custom bend waypoints */}
          {handleWaypoints.map((wp) => (
            <circle
              key={`wp-${wp.idx}`}
              cx={wp.x}
              cy={wp.y}
              r={selected ? 7 : 5.5}
              className={`rt-edge-handle handle-waypoint ${selected ? 'sel' : ''}`}
              title="Drag waypoint to bend connection (Right-click or double-click to remove)"
              onPointerDown={(ev) => handlePointerDown(ev, 'wp', wp.idx)}
              onDoubleClick={(ev) => {
                ev.stopPropagation();
                ev.preventDefault();
                data?.onDeleteWaypoint?.(id, wp.idx);
              }}
              onContextMenu={(ev) => {
                ev.stopPropagation();
                ev.preventDefault();
                data?.onDeleteWaypoint?.(id, wp.idx);
              }}
            />
          ))}
        </g>
      )}
    </>
  );
}
