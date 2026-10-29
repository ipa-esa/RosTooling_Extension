/**
 * Live Orthogonal Edge Router with Jump Bridge (Hopping Arc) Intersections
 * and Interactive Corridor/Waypoint Handles.
 */

// Global registry of vertical segments across all active edges for jump bridges
const edgeVerticalsRegistry = new Map();

export function registerEdgeVerticals(edgeId, segments) {
  edgeVerticalsRegistry.set(edgeId, segments);
}

export function unregisterEdgeVerticals(edgeId) {
  edgeVerticalsRegistry.delete(edgeId);
}

export function getOtherVerticals(currentEdgeId) {
  const result = [];
  for (const [id, segs] of edgeVerticalsRegistry.entries()) {
    if (id !== currentEdgeId && Array.isArray(segs)) {
      result.push(...segs);
    }
  }
  return result;
}

export function distToSegment(p, v, w) {
  const l2 = (w.x - v.x) * (w.x - v.x) + (w.y - v.y) * (w.y - v.y);
  if (l2 === 0) return Math.hypot(p.x - v.x, p.y - v.y);
  const t = Math.max(0, Math.min(1, ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2));
  const projX = v.x + t * (w.x - v.x);
  const projY = v.y + t * (w.y - v.y);
  return Math.hypot(p.x - projX, p.y - projY);
}

export function simplifyPolyline(pts) {
  if (pts.length <= 2) return pts;
  const res = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = res[res.length - 1];
    const cur = pts[i];
    const next = pts[i + 1];
    const isCollinearX = prev.x === cur.x && cur.x === next.x;
    const isCollinearY = prev.y === cur.y && cur.y === next.y;
    if (!isCollinearX && !isCollinearY) {
      res.push(cur);
    }
  }
  res.push(pts[pts.length - 1]);
  return res;
}

export function insertWaypointIntoConnection(waypoints, clickX, clickY, existingPts) {
  const wps = Array.isArray(waypoints) ? [...waypoints] : [];
  if (wps.length === 0 || !existingPts || existingPts.length < 2) {
    wps.push({ x: Math.round(clickX), y: Math.round(clickY) });
    return wps;
  }

  let bestSegIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < existingPts.length - 1; i++) {
    const d = distToSegment({ x: clickX, y: clickY }, existingPts[i], existingPts[i + 1]);
    if (d < bestDist) {
      bestDist = d;
      bestSegIdx = i;
    }
  }

  let insertIdx = wps.length;
  for (let w = 0; w < wps.length; w++) {
    const wp = wps[w];
    const ptIdx = existingPts.findIndex(
      (pt) => Math.abs(pt.x - wp.x) < 4 && Math.abs(pt.y - wp.y) < 4
    );
    if (ptIdx !== -1 && bestSegIdx < ptIdx) {
      insertIdx = w;
      break;
    }
  }
  wps.splice(insertIdx, 0, { x: Math.round(clickX), y: Math.round(clickY) });
  return wps;
}

/**
 * Computes exact orthogonal route, jump arcs, and handle positions directly
 * from live React Flow handle coordinates (sourceX, sourceY, targetX, targetY).
 */
export function computeLiveOrthogonalEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  midX,
  midY,
  waypoints = [],
}) {
  const STUB = 26;
  const isDirect = sourceX + STUB < targetX - STUB;

  let pts = [];
  let handleV = null;
  let handleH = null;

  if (waypoints && waypoints.length > 0) {
    // 1. Waypoint route
    pts = [
      { x: sourceX, y: sourceY },
      { x: sourceX + STUB, y: sourceY },
    ];
    let curY = sourceY;
    waypoints.forEach((wp) => {
      pts.push({ x: wp.x, y: curY });
      pts.push({ x: wp.x, y: wp.y });
      curY = wp.y;
    });
    pts.push({ x: targetX - STUB, y: curY });
    pts.push({ x: targetX - STUB, y: targetY });
    pts.push({ x: targetX, y: targetY });
  } else if (isDirect) {
    // 2. Direct left-to-right orthogonal route
    const defaultMidX = Math.round((sourceX + targetX) / 2);
    const finalMidX = midX != null ? midX : defaultMidX;

    pts = [
      { x: sourceX, y: sourceY },
      { x: sourceX + STUB, y: sourceY },
      { x: finalMidX, y: sourceY },
      { x: finalMidX, y: targetY },
      { x: targetX - STUB, y: targetY },
      { x: targetX, y: targetY },
    ];

    if (Math.abs(targetY - sourceY) > 8) {
      handleV = {
        x: finalMidX,
        y: Math.round((sourceY + targetY) / 2),
      };
    }
  } else {
    // 3. Wrap-around route (target is to the left of source)
    const wrapY = midY != null ? midY : Math.round(Math.min(sourceY, targetY) - 50);
    const vertX1 = midX != null ? midX : Math.round(sourceX + STUB + 16);
    const vertX2 = Math.round(targetX - STUB - 16);

    pts = [
      { x: sourceX, y: sourceY },
      { x: vertX1, y: sourceY },
      { x: vertX1, y: wrapY },
      { x: vertX2, y: wrapY },
      { x: vertX2, y: targetY },
      { x: targetX, y: targetY },
    ];

    handleV = {
      x: vertX1,
      y: Math.round((sourceY + wrapY) / 2),
    };

    handleH = {
      x: Math.round((vertX1 + vertX2) / 2),
      y: wrapY,
    };
  }

  pts = simplifyPolyline(pts);

  // Register vertical segments of this wire for other wires to hop over
  const myVerticals = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p1 = pts[i];
    const p2 = pts[i + 1];
    if (p1.x === p2.x && Math.abs(p2.y - p1.y) > 8) {
      myVerticals.push({
        edgeId: id,
        x: p1.x,
        minY: Math.min(p1.y, p2.y),
        maxY: Math.max(p1.y, p2.y),
      });
    }
  }
  registerEdgeVerticals(id, myVerticals);

  // Query vertical segments of other wires for jump bridge detection
  const otherVerticals = getOtherVerticals(id);

  // Build SVG path with jump bridge arcs
  let pathD = '';
  if (pts.length >= 2) {
    pathD += `M ${pts[0].x} ${pts[0].y} `;

    for (let i = 0; i < pts.length - 1; i++) {
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const isHoriz = p1.y === p2.y;

      if (!isHoriz) {
        pathD += `L ${p2.x} ${p2.y} `;
      } else {
        const y = p1.y;
        const minX = Math.min(p1.x, p2.x);
        const maxX = Math.max(p1.x, p2.x);
        const goingRight = p2.x > p1.x;

        // Find intersecting vertical segments from other wires
        const intersections = [];
        otherVerticals.forEach((v) => {
          if (v.edgeId !== id) {
            if (v.x > minX + 8 && v.x < maxX - 8 && y > v.minY + 4 && y < v.maxY - 4) {
              intersections.push(v.x);
            }
          }
        });

        if (intersections.length === 0) {
          pathD += `L ${p2.x} ${p2.y} `;
        } else {
          intersections.sort((a, b) => (goingRight ? a - b : b - a));

          intersections.forEach((ix) => {
            const bridgeRadius = 6;
            const beforeX = goingRight ? ix - bridgeRadius : ix + bridgeRadius;
            const afterX = goingRight ? ix + bridgeRadius : ix - bridgeRadius;

            pathD += `L ${beforeX} ${y} `;
            const sweep = goingRight ? 0 : 1;
            pathD += `A ${bridgeRadius} ${bridgeRadius} 0 0 ${sweep} ${afterX} ${y} `;
          });
          pathD += `L ${p2.x} ${p2.y} `;
        }
      }
    }
  }

  const handleWaypoints = (waypoints || []).map((wp, idx) => ({
    idx,
    x: wp.x,
    y: wp.y,
  }));

  return {
    pathD: pathD.trim(),
    pts,
    handleV,
    handleH,
    handleWaypoints,
  };
}
