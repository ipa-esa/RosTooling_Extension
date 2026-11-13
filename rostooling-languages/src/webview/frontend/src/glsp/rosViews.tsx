/** @jsx svg */
import { injectable } from 'inversify';
import type { VNode } from 'snabbdom';
import {
  svg,
  ShapeView,
  JumpingPolylineEdgeView,
  RenderingContext,
  GNode,
  GPort,
  GEdge,
  GModelElement,
  IView,
  IViewArgs,
  Point,
  setClass,
} from '@eclipse-glsp/client';
import { rosDiagramApi } from './rosDiagramApi';

// ============================================================================
// Sprotty views for the RosTooling GModel. All geometry (positions, sizes, port
// placement, ELK orthogonal routing points) comes from the Java GLSP server; these
// views only define how each element type looks and which gestures it offers.
// ============================================================================

type Args = Record<string, unknown>;
const argsOf = (el: GModelElement): Args => ((el as unknown as { args?: Args }).args || {});

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

@injectable()
export class RosNodeView extends ShapeView {
  render(node: Readonly<GNode>, context: RenderingContext): VNode | undefined {
    if (!this.isVisible(node, context)) return undefined;
    const a = argsOf(node);
    const w = Math.max(0, node.size.width);
    const h = Math.max(0, node.size.height);
    const name = String(a.nodeName || node.id);
    const ns = String(a.namespace || '');
    const title = ns ? `${ns.replace(/\/$/, '')}/${name}` : name;
    const params = a.totalParams !== undefined ? `${a.activeParams ?? 0}/${a.totalParams} params` : '';
    // The server wraps a long 'from' and grows the header by the extra lines.
    const fromLines = String(a.fromLines ?? a.from ?? '').split('\n');
    const headExtra = Math.max(0, fromLines.length - 1) * 13;
    return (
      <g class-ros-node={true} class-selected={node.selected} class-mouseover={node.hoverFeedback}
        on-dblclick={() => rosDiagramApi.openComponent(String(a.from || ''), name)}>
        <rect class-ros-node-card={true} x={0} y={0} width={w} height={h} rx={8} ry={8} />
        <path class-ros-node-head={true} d={`M 0 8 a 8 8 0 0 1 8 -8 h ${w - 16} a 8 8 0 0 1 8 8 v ${44 + headExtra} h ${-w} z`} />
        <text class-ros-node-title={true} x={12} y={22}>
          <title>{`${title}${a.from ? ` (${String(a.from)})` : ''}`}</title>
          {truncate(title, Number(a.titleMaxChars) || 32)}
        </text>
        <text class-ros-node-sub={true} x={12} y={40}>
          {fromLines.map((line, i) => <tspan x={12} dy={i === 0 ? 0 : 13}>{line}</tspan>)}
        </text>
        {a.isLifecycle ? (
          <g class-ros-badge={true} class-lc={true}>
            <rect x={w - 116} y={10} width={26} height={16} rx={8} />
            <text x={w - 103} y={21.5}>LC</text>
          </g>
        ) : null}
        {params ? (
          <g class-ros-badge={true}>
            <rect x={w - 86} y={10} width={76} height={16} rx={8} />
            <text x={w - 48} y={21.5}>{params}</text>
          </g>
        ) : null}
        {context.renderChildren(node)}
      </g>
    ) as unknown as VNode;
  }
}

@injectable()
export class RosPortView extends ShapeView {
  render(port: Readonly<GPort>, context: RenderingContext): VNode | undefined {
    if (!this.isVisible(port, context)) return undefined;
    const a = argsOf(port);
    const kind = port.type.replace('port:', '');
    const w = port.size.width;
    const h = port.size.height;
    const west = port.position.x < 0 || port.position.x < 20;
    const spec = String(a.specName || '');
    const label = `${String(a.interfaceName || port.id)}${spec ? ` : ${spec.split('/').pop()}` : ''}`;
    // The server wraps long labels to the card width and sizes the row for them.
    const lines = String(a.labelLines || label).split('\n');
    const lx = west ? w + 8 : -8;
    return (
      <g class-ros-port={true} class={{ [`ros-port-${kind}`]: true, inherited: !a.isExplicit }}
        class-selected={port.selected} class-mouseover={port.hoverFeedback}
        attrs-data-port-id={port.id}
        on-mousedown={(e: MouseEvent) => rosDiagramApi.startWire(port.id, e)}>
        <title>{`${kind.toUpperCase()} ${String(a.interfaceName || '')}${spec ? ` (${spec})` : ''}${a.isExplicit ? '' : ' — inherited from component'}`}</title>
        <rect class-ros-port-hit={true} x={-4} y={-4} width={w + 8} height={h + 8} />
        <rect class-ros-port-box={true} x={0} y={0} width={w} height={h} rx={2} />
        <text class-ros-port-label={true} class-west={west} class-east={!west} x={lx} y={h / 2 + 4}>
          {lines.map((line, i) => <tspan x={lx} dy={i === 0 ? 0 : 13}>{line}</tspan>)}
        </text>
      </g>
    ) as unknown as VNode;
  }
}

@injectable()
export class RosSubsystemView extends ShapeView {
  render(node: Readonly<GNode>, context: RenderingContext): VNode | undefined {
    if (!this.isVisible(node, context)) return undefined;
    const a = argsOf(node);
    const name = String(a.subSystemName || node.id);
    const collapsed = Boolean(a.collapsed);
    const hasPorts = Number(a.boundaryPortCount ?? 0) > 0;
    const w = node.size.width;
    return (
      <g class-ros-subsystem={true} class-selected={node.selected} class-mouseover={node.hoverFeedback}
        on-dblclick={() => rosDiagramApi.openSubsystem(name)}>
        <rect class-ros-frame={true} x={0} y={0} width={w} height={node.size.height} rx={10} ry={10} />
        <text class-ros-frame-title={true} x={14} y={22}>
          <title>{`SubSystem: ${name}`}</title>
          {`SubSystem: ${name}`}
        </text>
        {collapsed && hasPorts ? (
          <line x1={8} y1={34} x2={w - 8} y2={34} stroke="var(--rt-muted)" stroke-opacity={0.35} stroke-width={1} />
        ) : null}
        <g class-ros-toggle={true}
          on-mousedown={(e: MouseEvent) => e.stopPropagation()}
          on-click={(e: MouseEvent) => {
            e.stopPropagation();
            rosDiagramApi.toggleSubSystem(node.id, !collapsed);
          }}>
          <title>{collapsed ? 'Expand subsystem' : 'Collapse subsystem'}</title>
          <rect x={w - 30} y={8} width={20} height={20} rx={4} />
          <text x={w - 20} y={22}>{collapsed ? '+' : '−'}</text>
        </g>
        {context.renderChildren(node)}
      </g>
    ) as unknown as VNode;
  }
}

@injectable()
export class RosProcessView extends ShapeView {
  render(node: Readonly<GNode>, context: RenderingContext): VNode | undefined {
    if (!this.isVisible(node, context)) return undefined;
    const a = argsOf(node);
    return (
      <g class-ros-process={true} class-selected={node.selected} class-mouseover={node.hoverFeedback}>
        <rect class-ros-frame={true} x={0} y={0} width={node.size.width} height={node.size.height} rx={10} ry={10} />
        <text class-ros-frame-title={true} x={14} y={22}>{`Process: ${String(a.processName || node.id)}`}</text>
        <text class-ros-node-sub={true} x={14} y={40}>{`threads: ${String(a.threads ?? '')}`}</text>
        {context.renderChildren(node)}
      </g>
    ) as unknown as VNode;
  }
}

/**
 * ELK-routed connection with Sprotty line jumps at crossings (JumpingPolylineEdgeView) and an
 * arrowhead at the target end; colour by communication kind.
 */
@injectable()
export class RosConnectionView extends JumpingPolylineEdgeView {
  // `args` carries the graph-wide edge routing; the intersection post-processor stores the line
  // crossings in it. Dropping it makes every wire route alone, so no jumps are drawn.
  render(edge: Readonly<GEdge>, context: RenderingContext, args?: IViewArgs): VNode | undefined {
    const vnode = super.render(edge, context, args);
    if (vnode) {
      const kind = String(argsOf(edge).connectionKind || 'topic');
      setClass(vnode, 'ros-edge', true);
      setClass(vnode, `ros-edge-${kind}`, true);
    }
    return vnode;
  }

  protected renderLine(edge: GEdge, segments: Point[], context: RenderingContext, args?: Record<string, unknown>): VNode {
    const line = super.renderLine(edge, segments, context, args as never);
    setClass(line, 'ros-edge-line', true);
    return line;
  }

  protected renderAdditionals(edge: GEdge, segments: Point[], context: RenderingContext): VNode[] {
    const additionals = super.renderAdditionals(edge, segments, context);
    if (segments.length < 2) return additionals;
    const p1 = segments[segments.length - 2];
    const p2 = segments[segments.length - 1];
    const angle = (Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180) / Math.PI;
    additionals.push(
      (<path class-ros-edge-arrow={true} d="M 0 0 L -9 -4.5 L -9 4.5 Z"
        transform={`translate(${p2.x} ${p2.y}) rotate(${angle})`} />) as unknown as VNode
    );
    return additionals;
  }
}

/** Labels carried by the GModel for other clients; the node views draw their own text. */
@injectable()
export class HiddenView implements IView {
  render(): VNode | undefined {
    return undefined;
  }
}
