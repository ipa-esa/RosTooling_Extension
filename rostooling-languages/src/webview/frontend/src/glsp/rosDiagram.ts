import 'reflect-metadata';
import { Container, injectable } from 'inversify';
import {
  BaseGLSPClient,
  ConsoleLogger,
  LogLevel,
  bindOrRebind,
  DiagramLoader,
  ExportSvgAction,
  ExportSvgActionHandler,
  FeatureModule,
  FitToScreenAction,
  GEdge,
  GLabel,
  GNode,
  GPort,
  IActionHandler,
  RequestExportSvgAction,
  RequestModelAction,
  SelectionService,
  TYPES,
  TriggerEdgeCreationAction,
  configureDefaultModelElements,
  configureModelElement,
  createDiagramOptionsModule,
  edgeIntersectionModule,
  initializeDiagramContainer,
  resizeFeature,
  standaloneDefaultModule,
  toolPaletteModule,
} from '@eclipse-glsp/client';
import '@eclipse-glsp/client/css/glsp-sprotty.css';
import { hostBridge } from '../state/vscodeBridge';
import { WebviewGlspServer } from './WebviewGlspServer';
import { EDGE_TYPE, rosDiagramApi } from './rosDiagramApi';
import { HiddenView, RosConnectionView, RosNodeView, RosPortView, RosProcessView, RosSubsystemView } from './rosViews';

export const ROS_DIAGRAM_TYPE = 'ros-system-diagram';

/** Sends Sprotty's SVG export (RequestExportSvgAction -> ExportSvgAction) to VS Code's save dialog. */
@injectable()
class RosExportSvgActionHandler implements IActionHandler {
  handle(action: ExportSvgAction): void {
    hostBridge.exportSvg(sanitizeExportedSvg(action.svg));
  }
}

/**
 * Sprotty's exporter inlines computed styles; on the root <svg> that includes the hidden export
 * container's box (e.g. `width: 14px !important`). Keep the root sized by its viewBox instead.
 */
function sanitizeExportedSvg(svg: string): string {
  try {
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    const root = doc.documentElement;
    root.removeAttribute('style');
    root.removeAttribute('tabindex');
    const vb = (root.getAttribute('viewBox') || '').split(/\s+/).map(Number);
    if (vb.length === 4 && vb.every((n) => Number.isFinite(n))) {
      root.setAttribute('width', String(Math.ceil(vb[2])));
      root.setAttribute('height', String(Math.ceil(vb[3])));
      // The diagram is styled for the editor theme; give the standalone file that background.
      const bg = doc.createElementNS('http://www.w3.org/2000/svg', 'rect');
      bg.setAttribute('x', String(vb[0]));
      bg.setAttribute('y', String(vb[1]));
      bg.setAttribute('width', String(vb[2]));
      bg.setAttribute('height', String(vb[3]));
      bg.setAttribute('fill', getComputedStyle(document.body).backgroundColor || '#ffffff');
      root.insertBefore(bg, root.firstChild);
    }
    return new XMLSerializer().serializeToString(doc);
  } catch {
    return svg;
  }
}

const rosDiagramModule = new FeatureModule((bind, unbind, isBound, rebind) => {
  const context = { bind, unbind, isBound, rebind };
  // Surface client-side problems in the webview devtools instead of swallowing them.
  bindOrRebind(context, TYPES.ILogger).to(ConsoleLogger).inSingletonScope();
  bindOrRebind(context, TYPES.LogLevel).toConstantValue(LogLevel.warn);
  configureDefaultModelElements(context);
  configureModelElement(context, 'node:ros-node', GNode, RosNodeView, { disable: [resizeFeature] });
  configureModelElement(context, 'node:subsystem', GNode, RosSubsystemView, { disable: [resizeFeature] });
  configureModelElement(context, 'node:process', GNode, RosProcessView, { disable: [resizeFeature] });
  for (const kind of ['pub', 'sub', 'ss', 'sc', 'as', 'ac']) {
    configureModelElement(context, `port:${kind}`, GPort, RosPortView);
  }
  configureModelElement(context, EDGE_TYPE, GEdge, RosConnectionView);
  for (const label of ['label:name', 'label:subtitle', 'label:badge', 'label:type']) {
    configureModelElement(context, label, GLabel, HiddenView);
  }
});

export interface RosDiagramHandle {
  dispatch(action: unknown): void;
  fit(): void;
  exportSvg(): void;
  startConnectTool(): void;
  dispose(): void;
}

/**
 * Mounts the Eclipse GLSP (Sprotty) diagram client for a .rossystem file into `baseDivId`.
 * The model, its ELK layout and all validation come from the Java GLSP server.
 */
export async function mountRosDiagram(options: {
  baseDivId: string;
  hiddenDivId: string;
  sourceUri: string;
  isReadOnly: boolean;
  onSelection: (selectedIds: string[]) => void;
}): Promise<RosDiagramHandle> {
  const server = new WebviewGlspServer();
  const client = new BaseGLSPClient({ id: 'rostooling-webview' });
  client.configureServer(server);
  server.connectProxy(client.proxy);

  const clientId = `ros_diagram_${Date.now().toString(36)}`;
  const container = initializeDiagramContainer(
    new Container(),
    rosDiagramModule,
    edgeIntersectionModule,
    standaloneDefaultModule,
    createDiagramOptionsModule(
      {
        clientId,
        diagramType: ROS_DIAGRAM_TYPE,
        glspClientProvider: async () => client,
        sourceUri: options.sourceUri,
        editMode: options.isReadOnly ? 'readonly' : 'editable',
      },
      { baseDiv: options.baseDivId, hiddenDiv: options.hiddenDivId }
    ),
    // Nodes are added from the component catalogue (they need a 'from' reference), so the
    // generic GLSP tool palette is not used.
    { remove: toolPaletteModule }
  );
  // Route Sprotty's SVG export to VS Code (after GLSP's exportModule has bound its handler).
  container.bind(RosExportSvgActionHandler).toSelf().inSingletonScope();
  if (container.isBound(ExportSvgActionHandler)) {
    container.rebind(ExportSvgActionHandler).toService(RosExportSvgActionHandler);
  } else {
    container.bind(TYPES.ActionHandlerRegistration).toDynamicValue((ctx) => ({
      actionKind: ExportSvgAction.KIND,
      factory: () => ctx.container.get(RosExportSvgActionHandler),
    }));
  }

  const dispatcher = container.get<{ dispatch(a: unknown): Promise<void> }>(TYPES.IActionDispatcher);
  const dispatch = (action: unknown) => dispatcher.dispatch(action);
  rosDiagramApi.attach(dispatch as never, options.isReadOnly);

  server.onReload(() => {
    void dispatch(RequestModelAction.create({ options: { sourceUri: options.sourceUri, diagramType: ROS_DIAGRAM_TYPE } }));
  });

  const selection = container.get(SelectionService);
  const selectionSub = selection.onSelectionChanged(() => options.onSelection(selection.getSelectedElementIDs()));

  const loader = container.get(DiagramLoader);
  await loader.load({ requestModelOptions: { sourceUri: options.sourceUri, diagramType: ROS_DIAGRAM_TYPE } });
  setTimeout(() => void dispatch(FitToScreenAction.create([], { padding: 24, maxZoom: 1.2 })), 50);

  return {
    dispatch: (a) => void dispatch(a),
    fit: () => void dispatch(FitToScreenAction.create([], { padding: 24, maxZoom: 1.2 })),
    exportSvg: () => void dispatch(RequestExportSvgAction.create()),
    startConnectTool: () => void dispatch(TriggerEdgeCreationAction.create(EDGE_TYPE)),
    dispose: () => {
      selectionSub.dispose();
      void client.stop();
    },
  };
}
