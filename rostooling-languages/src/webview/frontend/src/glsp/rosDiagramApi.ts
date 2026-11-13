import type { Action } from '@eclipse-glsp/client';
import { hostBridge } from '../state/vscodeBridge';

/**
 * Bridge between the Sprotty views / React panels and the GLSP action dispatcher of the
 * .rossystem diagram. Every model change is a GLSP action/operation dispatched here.
 */
type Dispatch = (action: Action) => Promise<void> | void;

let dispatchFn: Dispatch | null = null;
let readOnly = false;

export const EDGE_TYPE = 'edge:ros-connection';

export const rosDiagramApi = {
  attach(dispatch: Dispatch, isReadOnly: boolean): void {
    dispatchFn = dispatch;
    readOnly = isReadOnly;
  },

  isAttached(): boolean {
    return dispatchFn !== null;
  },

  dispatch(action: Action): boolean {
    if (!dispatchFn) return false;
    void dispatchFn(action);
    return true;
  },

  toggleSubSystem(elementId: string, collapsed: boolean): void {
    if (readOnly) return;
    this.dispatch({ kind: 'toggleSubSystem', isOperation: true, elementId, collapsed } as unknown as Action);
  },

  openComponent(from: string, label: string): void {
    hostBridge.openComponentRos2({ from, label });
  },

  openSubsystem(subRef: string): void {
    hostBridge.openSubsystemRosSystem({ subRef });
  },

  /**
   * Drag-to-connect from a port: draws a rubber band in screen space and, when released over
   * another port, dispatches a standard GLSP CreateEdgeOperation. The server (Xtext validator +
   * CreateConnectionOperationHandler) decides whether the connection is legal.
   */
  startWire(sourcePortId: string, event: MouseEvent): void {
    if (readOnly || event.button !== 0 || !dispatchFn) return;
    event.stopPropagation(); // keep Sprotty's move tool from dragging the owning node
    event.preventDefault();
    const portEl = (event.currentTarget as Element) || (event.target as Element);
    const box = portEl.getBoundingClientRect();
    const x0 = box.left + box.width / 2;
    const y0 = box.top + box.height / 2;

    const overlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    overlay.setAttribute('class', 'ros-wire-overlay');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    overlay.appendChild(path);
    document.body.appendChild(overlay);

    const portAt = (x: number, y: number): string | null => {
      const hit = document.elementFromPoint(x, y);
      const g = hit ? (hit as Element).closest('[data-port-id]') : null;
      return g ? g.getAttribute('data-port-id') : null;
    };
    let hovered: Element | null = null;
    const move = (e: MouseEvent) => {
      const midX = x0 + (e.clientX - x0) / 2;
      path.setAttribute('d', `M ${x0} ${y0} L ${midX} ${y0} L ${midX} ${e.clientY} L ${e.clientX} ${e.clientY}`);
      const hit = document.elementFromPoint(e.clientX, e.clientY);
      const g = hit ? (hit as Element).closest('[data-port-id]') : null;
      if (hovered && hovered !== g) hovered.classList.remove('ros-port-drop');
      if (g && g.getAttribute('data-port-id') !== sourcePortId) g.classList.add('ros-port-drop');
      hovered = g;
    };
    const up = (e: MouseEvent) => {
      window.removeEventListener('mousemove', move, true);
      window.removeEventListener('mouseup', up, true);
      overlay.remove();
      hovered?.classList.remove('ros-port-drop');
      const targetPortId = portAt(e.clientX, e.clientY);
      if (targetPortId && targetPortId !== sourcePortId) {
        this.dispatch({
          kind: 'createEdge',
          isOperation: true,
          elementTypeId: EDGE_TYPE,
          sourceElementId: sourcePortId,
          targetElementId: targetPortId,
          args: {},
        } as unknown as Action);
      }
    };
    window.addEventListener('mousemove', move, true);
    window.addEventListener('mouseup', up, true);
    move(event);
  },
};
