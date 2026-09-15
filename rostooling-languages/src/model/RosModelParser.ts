import {
  RosProject,
  RosNode,
  RosInterface,
  RosParameter,
  RosSubSystem,
  RosInteractionKind,
  RosTypeSpec,
  RosProcess,
} from './RosModelTypes';

const BLOCK_TO_KIND: Record<string, RosInteractionKind> = {
  publishers: 'pub',
  subscribers: 'sub',
  serviceservers: 'ss',
  serviceclients: 'sc',
  actionservers: 'as',
  actionclients: 'ac',
};

export const RosModelParser = {
  splitLines(text: string): string[] {
    return String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  },

  indentOf(line: string): number {
    const m = /^[ \t]*/.exec(line);
    if (!m) return 0;
    let col = 0;
    for (const ch of m[0]) {
      col = ch === '\t' ? ((col >> 3) + 1) * 8 : col + 1;
    }
    return col;
  },

  splitComment(line: string): [string, string | null] {
    let q: string | null = null;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) {
        if (ch === q) q = null;
        continue;
      }
      if (ch === '"' || ch === "'") {
        q = ch;
        continue;
      }
      if (ch === '#') {
        return [line.slice(0, i), line.slice(i + 1)];
      }
    }
    return [line, null];
  },

  cleanNote(t: string | null): string | null {
    return t == null ? null : String(t).replace(/^ /, '').replace(/\s+$/, '');
  },

  unquote(s: unknown): string {
    let str = String(s == null ? '' : s).trim();
    if (
      str.length > 1 &&
      ((str[0] === '"' && str[str.length - 1] === '"') || (str[0] === "'" && str[str.length - 1] === "'"))
    ) {
      str = str.slice(1, -1);
      return str.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }
    return str;
  },

  inferKindFromName(nameOrLabel: string): RosInteractionKind {
    const s = nameOrLabel.toLowerCase();
    if (s.includes('sub') || s.endsWith('_in') || s.startsWith('in_') || s.includes('input') || s.includes('listener')) {
      return 'sub';
    }
    if (s.includes('pub') || s.endsWith('_out') || s.startsWith('out_') || s.includes('output') || s.includes('talker')) {
      return 'pub';
    }
    if (s.includes('srv_server') || s.includes('service_server') || s.endsWith('_ss') || s.includes('server')) {
      return 'ss';
    }
    if (s.includes('srv_client') || s.includes('service_client') || s.endsWith('_sc') || s.includes('client')) {
      return 'sc';
    }
    if (s.includes('act_server') || s.includes('action_server') || s.endsWith('_as')) {
      return 'as';
    }
    if (s.includes('act_client') || s.includes('action_client') || s.endsWith('_ac')) {
      return 'ac';
    }
    return 'pub';
  },

  /**
   * Parse a .rossystem content string into a RosProject adhering strictly to RosSystem.xtext grammar
   */
  parseRosSystem(text: string, fileName = 'system.rossystem'): RosProject {
    const lines = this.splitLines(text);
    const proj: RosProject = {
      formatVersion: 4,
      system: { name: 'ros_system', fromFile: undefined, comments: {} },
      subSystems: [],
      processes: [],
      nodes: [],
      connections: [],
      packages: {},
      types: {},
      view: {
        tx: 40,
        ty: 40,
        k: 1,
        level: 3,
        subStates: {},
        subPos: {},
      },
      seededFrom: fileName,
    };

    let seenRoot = false;
    let leadComments: string[] = [];
    let curSection: 'subSystems' | 'nodes' | 'connections' | 'parameters' | 'processes' | null = null;
    let curNode: RosNode | null = null;
    let curProcess: RosProcess | null = null;
    let curSubSection: 'interfaces' | 'parameters' | null = null;

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const raw = lines[lineIdx];
      const lineNo = lineIdx + 1;
      const [code, noteRaw] = this.splitComment(raw);
      const note = this.cleanNote(noteRaw);
      const body = code.trim();

      if (!body) {
        if (note != null) leadComments.push(note);
        continue;
      }

      const ind = this.indentOf(code);
      const keyMatch = /^("[^"]*"|'[^']*'|[^:#]+?)\s*:\s*(.*)$/.exec(body);
      const kw = keyMatch ? this.unquote(keyMatch[1]) : null;
      const val = keyMatch ? keyMatch[2].trim() : null;

      // Root system declaration: name=EString ':'
      if (!seenRoot && keyMatch && !val && ind === 0) {
        proj.system.name = kw || 'ros_system';
        seenRoot = true;
        if (leadComments.length) {
          proj.system.comments = { header: [...leadComments] };
          leadComments = [];
        }
        continue;
      }

      if (!seenRoot) continue;

      // Top-level system fromFile: fromFile=EString (RosSystem.xtext:16)
      if (seenRoot && keyMatch && kw === 'fromFile' && ind <= 2) {
        proj.system.fromFile = this.unquote(val);
        continue;
      }

      // Top level sections (subSystems, processes, nodes, parameters, connections)
      if (seenRoot && keyMatch && !val && ind <= 2) {
        if (kw === 'subSystems') {
          curSection = 'subSystems';
          curNode = null;
          curProcess = null;
          leadComments = [];
          continue;
        }
        if (kw === 'nodes') {
          curSection = 'nodes';
          curNode = null;
          curProcess = null;
          curSubSection = null;
          leadComments = [];
          continue;
        }
        if (kw === 'connections') {
          curSection = 'connections';
          curNode = null;
          curProcess = null;
          leadComments = [];
          continue;
        }
        if (kw === 'parameters') {
          curSection = 'parameters';
          curNode = null;
          curProcess = null;
          leadComments = [];
          continue;
        }
        if (kw === 'processes') {
          curSection = 'processes';
          curNode = null;
          curProcess = null;
          leadComments = [];
          continue;
        }
      }

      // SubSystems entries: SubSystem: system=[System|EString]
      if (curSection === 'subSystems') {
        let subRef = '';
        const listMatch = /^-\s*(.*)$/.exec(body);
        if (listMatch) {
          subRef = this.unquote(listMatch[1]);
        } else if (!keyMatch || val === '') {
          subRef = this.unquote(body.replace(/:$/, ''));
        }
        if (subRef && subRef !== 'subSystems') {
          const sub: RosSubSystem = {
            ref: subRef,
            state: 'collapsed',
            line: lineNo,
            comments: leadComments.length ? { before: [...leadComments] } : undefined,
          };
          if (proj.view?.subStates && !proj.view.subStates[subRef]) {
            proj.view.subStates[subRef] = 'collapsed';
          }
          proj.subSystems.push(sub);
          leadComments = [];
          continue;
        }
      }

      // Processes entries: Process (RosSystem.xtext:51-58)
      if (curSection === 'processes') {
        if (!proj.processes) proj.processes = [];
        if (keyMatch && !val && ind <= 4 && kw !== 'nodes' && kw !== 'threads') {
          const procName = kw || 'process';
          curProcess = {
            name: procName,
            nodes: [],
            line: lineNo,
            comments: leadComments.length ? { before: [...leadComments] } : undefined,
          };
          if (note) {
            curProcess.comments = { ...(curProcess.comments || {}), line: note };
          }
          proj.processes.push(curProcess);
          leadComments = [];
          continue;
        }

        if (curProcess) {
          if (keyMatch && kw === 'nodes') {
            const rawNodes = val || '';
            const stripped = rawNodes.trim().replace(/^\[/, '').replace(/\]$/, '').trim();
            if (stripped) {
              const parts = stripped.split(',').map((s: string) => this.unquote(s.trim())).filter(Boolean);
              curProcess.nodes.push(...parts);
            }
            continue;
          }
          if (keyMatch && kw === 'threads') {
            const parsedThreads = parseInt(val || '1', 10);
            curProcess.threads = isNaN(parsedThreads) ? 1 : parsedThreads;
            continue;
          }
        }
      }

      // Nodes section (RosNode, RosSystem.xtext:60-75)
      if (curSection === 'nodes') {
        if (keyMatch && !val && ind <= 4 && kw !== 'interfaces' && kw !== 'parameters') {
          const nodeLabel = kw || 'node';
          curNode = {
            id: `n_${nodeLabel}`,
            label: nodeLabel,
            ifaces: [],
            params: [],
            backing: 'local',
            line: lineNo,
            lineEnd: lineNo,
            comments: leadComments.length ? { before: [...leadComments] } : undefined,
          };
          if (note) {
            curNode.comments = { ...(curNode.comments || {}), line: note };
          }
          proj.nodes.push(curNode);
          curSubSection = null;
          leadComments = [];
          continue;
        }

        if (curNode) {
          curNode.lineEnd = lineNo;
          if (keyMatch && kw === 'from') {
            curNode.from = this.unquote(val);
            const parts = (curNode.from || '').split('.');
            if (parts.length >= 2) {
              curNode.pkg = parts[0];
              curNode.artifact = parts[1];
            }
            leadComments = [];
            continue;
          }
          if (keyMatch && kw === 'namespace') {
            curNode.namespace = this.unquote(val);
            leadComments = [];
            continue;
          }
          if (keyMatch && !val && kw === 'interfaces') {
            curSubSection = 'interfaces';
            leadComments = [];
            continue;
          }
          if (keyMatch && !val && kw === 'parameters') {
            curSubSection = 'parameters';
            leadComments = [];
            continue;
          }

          // Node interface: '-' name=EString ':' (reference=InterfaceReference)
          // InterfaceReference: "pub->" | "sub->" | "ss->" | "sc->" | "as->" | "ac->" from=[...|EString]
          if (curSubSection === 'interfaces') {
            // Check for explicit Xtext arrow: - "label": kind-> "artifact::interface"
            const arrowMatch = /^-\s*("[^"]*"|'[^']*'|[^:#]+?)\s*:\s*(pub|sub|ss|sc|as|ac)->\s*(.*)$/.exec(body);
            if (arrowMatch) {
              const expLabel = this.unquote(arrowMatch[1]);
              const kind = arrowMatch[2] as RosInteractionKind;
              const refTarget = this.unquote(arrowMatch[3]);
              const ifaceName = refTarget.includes('::') ? refTarget.split('::')[1] : refTarget;
              const iface: RosInterface = {
                id: `i_${curNode.label}_${expLabel}`,
                name: ifaceName,
                label: expLabel,
                kind: kind,
                exposed: true,
                line: lineNo,
                comments: leadComments.length ? { before: [...leadComments] } : undefined,
              };
              curNode.ifaces.push(iface);
              leadComments = [];
              continue;
            }

            // Fallback for interface without arrow prefix
            const ifaceMatch = /^-\s*("[^"]*"|'[^']*'|[^:#]+?)\s*:\s*(.*)$/.exec(body);
            if (ifaceMatch) {
              const expLabel = this.unquote(ifaceMatch[1]);
              const refTarget = this.unquote(ifaceMatch[2]);
              const ifaceName = refTarget.includes('::') ? refTarget.split('::')[1] : refTarget;
              const guessedKind = this.inferKindFromName(`${expLabel}_${ifaceName}`);
              const iface: RosInterface = {
                id: `i_${curNode.label}_${expLabel}`,
                name: ifaceName,
                label: expLabel,
                kind: guessedKind,
                exposed: true,
                line: lineNo,
                comments: leadComments.length ? { before: [...leadComments] } : undefined,
              };
              curNode.ifaces.push(iface);
              leadComments = [];
              continue;
            }
          }

          // Node parameter item: '-' name=EString ':' from=[ros::Parameter|EString] / 'value:' value=ParameterValue
          if (curSubSection === 'parameters') {
            const paramMatch = /^-\s*("[^"]*"|'[^']*'|[^:#]+?)\s*:\s*(.*)$/.exec(body);
            if (paramMatch) {
              const paramLabel = this.unquote(paramMatch[1]);
              const refTarget = this.unquote(paramMatch[2]);
              const paramName = refTarget.includes('::') ? refTarget.split('::')[1] : refTarget;
              const param: RosParameter = {
                id: `p_${curNode.label}_${paramLabel}`,
                name: paramName,
                label: paramLabel,
                exposed: true,
                ptype: 'String',
                line: lineNo,
                comments: leadComments.length ? { before: [...leadComments] } : undefined,
              };
              curNode.params.push(param);
              leadComments = [];
              continue;
            }
            if (keyMatch && kw === 'value' && curNode.params.length > 0) {
              const lastParam = curNode.params[curNode.params.length - 1];
              lastParam.sysValue = this.unquote(val);
              lastParam.value = lastParam.sysValue;
              continue;
            }
          }
        }
      }

      // Connections section:
      // RosSystemConnection: '-''[' from=[RosInterface|EString] ',' to=[RosInterface|EString] ']'
      if (curSection === 'connections') {
        let fromLabel: string | null = null;
        let toLabel: string | null = null;

        // Xtext bracketed connection: - [from, to] or - ["from", "to"]
        const connBracket = /^-\s*\[\s*("[^"]*"|'[^']*'|[^,\]\s]+)\s*,\s*("[^"]*"|'[^']*'|[^,\]\s]+)\s*\]/.exec(body);
        if (connBracket) {
          fromLabel = this.unquote(connBracket[1]);
          toLabel = this.unquote(connBracket[2]);
        } else {
          // Lenient fallback: - "from": "to"
          const connMatch = /^-\s*("[^"]*"|'[^']*'|[^:#]+?)\s*:\s*(.*)$/.exec(body);
          if (connMatch) {
            fromLabel = this.unquote(connMatch[1]);
            toLabel = this.unquote(connMatch[2]);
          }
        }

        if (fromLabel && toLabel) {
          let fromNode: RosNode | undefined;
          let fromIface: RosInterface | undefined;
          let toNode: RosNode | undefined;
          let toIface: RosInterface | undefined;

          for (const n of proj.nodes) {
            for (const f of n.ifaces) {
              if (f.label === fromLabel || f.name === fromLabel) {
                fromNode = n;
                fromIface = f;
              }
              if (f.label === toLabel || f.name === toLabel) {
                toNode = n;
                toIface = f;
              }
            }
          }

          if (fromNode && fromIface && toNode && toIface) {
            proj.connections.push({
              id: `c_${fromLabel}_${toLabel}`,
              from: { n: fromNode.id, i: fromIface.id },
              to: { n: toNode.id, i: toIface.id },
              line: lineNo,
              comments: leadComments.length ? { before: [...leadComments] } : undefined,
            });
          }
          leadComments = [];
          continue;
        }
      }
    }

    return proj;
  },

  /**
   * Parse a .ros2 or .ros1 package file into a RosProject adhering strictly to Ros2.xtext / Ros.xtext
   */
  parseRos2(text: string, fileName = 'package.ros2'): RosProject {
    const lines = this.splitLines(text);
    const proj: RosProject = {
      formatVersion: 4,
      system: { name: 'package_system', comments: {} },
      subSystems: [],
      nodes: [],
      connections: [],
      packages: {},
      types: {},
      view: { tx: 40, ty: 40, k: 1, level: 3 },
      seededFrom: fileName,
    };

    let seenRoot = false;
    let pkgName = 'ros_package';
    let gitRepo: string | undefined;
    let leadComments: string[] = [];
    let curArtifact: { name: string; node: string; ifaces: RosInterface[]; params: RosParameter[] } | null = null;
    let curBlock: RosInteractionKind | null = null;
    let inParams = false;
    let curIface: RosInterface | null = null;
    let curParam: RosParameter | null = null;
    let curQos: Record<string, string> | null = null;

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const raw = lines[lineIdx];
      const lineNo = lineIdx + 1;
      const [code, noteRaw] = this.splitComment(raw);
      const note = this.cleanNote(noteRaw);
      const body = code.trim();

      if (!body) {
        if (note != null) leadComments.push(note);
        continue;
      }

      const ind = this.indentOf(code);
      const keyMatch = /^("[^"]*"|'[^']*'|[^:#]+?)\s*:\s*(.*)$/.exec(body);
      const kw = keyMatch ? this.unquote(keyMatch[1]) : null;
      const val = keyMatch ? keyMatch[2].trim() : null;

      if (!seenRoot && keyMatch && !val && ind === 0) {
        pkgName = (kw || 'ros_package').replace(/^.*[\\/]/, '').replace(/\.ros2$/, '').replace(/\.ros1$/, '').trim() || 'ros_package';
        proj.system.name = pkgName;
        seenRoot = true;
        leadComments = [];
        continue;
      }

      if (!seenRoot) continue;

      if (keyMatch && kw === 'fromGitRepo') {
        gitRepo = this.unquote(val);
        leadComments = [];
        continue;
      }

      if (keyMatch && kw === 'artifacts' && !val) {
        leadComments = [];
        continue;
      }

      // New Artifact
      if (keyMatch && !val && ind <= 4 && kw !== 'qos' && !BLOCK_TO_KIND[kw || ''] && kw !== 'parameters') {
        const artName = kw || 'artifact';
        curArtifact = {
          name: artName,
          node: artName,
          ifaces: [],
          params: [],
        };
        curBlock = null;
        inParams = false;
        curIface = null;
        curParam = null;
        curQos = null;

        const nodeObj: RosNode = {
          id: `n_${artName}`,
          label: curArtifact.node,
          pkg: pkgName,
          artifact: curArtifact.name,
          from: `${pkgName}.${curArtifact.name}`,
          ifaces: curArtifact.ifaces,
          params: curArtifact.params,
          backing: 'local',
          line: lineNo,
          lineEnd: lineNo,
          comments: leadComments.length ? { before: [...leadComments] } : undefined,
        };
        proj.nodes.push(nodeObj);
        leadComments = [];
        continue;
      }

      if (curArtifact) {
        const lastNode = proj.nodes[proj.nodes.length - 1];
        if (lastNode) lastNode.lineEnd = lineNo;

        if (keyMatch && kw === 'node' && val) {
          curArtifact.node = this.unquote(val);
          if (lastNode) lastNode.label = curArtifact.node;
          leadComments = [];
          continue;
        }

        if (keyMatch && !val && kw && BLOCK_TO_KIND[kw]) {
          curBlock = BLOCK_TO_KIND[kw];
          inParams = false;
          curIface = null;
          curParam = null;
          curQos = null;
          leadComments = [];
          continue;
        }

        if (keyMatch && !val && kw === 'parameters') {
          inParams = true;
          curBlock = null;
          curIface = null;
          curParam = null;
          curQos = null;
          leadComments = [];
          continue;
        }

        if (keyMatch && !val && kw === 'qos') {
          curQos = {};
          if (curIface) curIface.qos = curQos;
          continue;
        }

        if (curQos && keyMatch && val) {
          curQos[kw || ''] = this.unquote(val);
          continue;
        }

        // Interface definition
        if (keyMatch && !val && curBlock) {
          const ifName = kw || 'iface';
          curIface = {
            id: `i_${curArtifact.name}_${ifName}`,
            name: ifName,
            kind: curBlock,
            label: ifName,
            exposed: true,
            line: lineNo,
            comments: leadComments.length ? { before: [...leadComments] } : undefined,
          };
          curArtifact.ifaces.push(curIface);
          curParam = null;
          curQos = null;
          leadComments = [];
          continue;
        }

        // Parameter definition
        if (keyMatch && !val && inParams) {
          const pName = kw || 'param';
          curParam = {
            id: `p_${curArtifact.name}_${pName}`,
            name: pName,
            label: pName,
            ptype: 'String',
            exposed: true,
            line: lineNo,
            comments: leadComments.length ? { before: [...leadComments] } : undefined,
          };
          curArtifact.params.push(curParam);
          curIface = null;
          curQos = null;
          leadComments = [];
          continue;
        }

        if (keyMatch && val && curIface && kw === 'type') {
          curIface.type = this.unquote(val);
          continue;
        }

        if (keyMatch && val && curParam) {
          if (kw === 'type') curParam.ptype = this.unquote(val);
          if (kw === 'default' || kw === 'value') {
            curParam.value = this.unquote(val);
            curParam.sysValue = curParam.value;
          }
          continue;
        }
      }
    }

    proj.packages[pkgName] = {
      name: pkgName,
      fromGitRepo: gitRepo,
      artifacts: proj.nodes.map((n) => ({
        name: n.artifact || n.label,
        node: n.label,
        ifaces: n.ifaces,
        params: n.params,
      })),
    };

    return proj;
  },

  tokenizeRosLine(line: string): string[] {
    const clean = this.splitComment(line)[0].trim();
    if (!clean) return [];
    const regex = /('[^']*'(?:\[\])?|"[^"]*"(?:\[\])?|\S+)/g;
    const tokens: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = regex.exec(clean)) !== null) {
      tokens.push(m[0]);
    }
    return tokens;
  },

  /**
   * Parse a .ros model file (ROS Communication Objects) adhering strictly to Ros.xtext grammar
   */
  parseRos(text: string, fileName = 'common.ros'): RosProject {
    const lines = this.splitLines(text);
    const cleanFileName = fileName.replace(/^.*[\\/]/, '').replace(/\.ros$/, '');
    const proj: RosProject = {
      formatVersion: 4,
      isRos: true,
      isRosSystem: false,
      system: { name: '' },
      subSystems: [],
      nodes: [],
      connections: [],
      packages: {},
      types: {},
    };

    let curPkg = '';
    let curBlock: 'msgs' | 'srvs' | 'actions' | null = null;
    let curCompartment: string | null = null;
    let curTypeSpec: RosTypeSpec | null = null;
    let gitRepo: string | undefined = undefined;

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const raw = lines[lineIdx];
      const lineNo = lineIdx + 1;
      const [lineWithoutComment] = this.splitComment(raw);
      const clean = lineWithoutComment.trim();
      if (!clean) continue;

      const ind = this.indentOf(lineWithoutComment);
      const tokens = this.tokenizeRosLine(lineWithoutComment);
      if (tokens.length === 0) continue;

      // Package declaration at root indent
      if (ind === 0 && clean.endsWith(':')) {
        curPkg = this.unquote(clean.slice(0, -1)).replace(/^.*[\\/]/, '').replace(/\.ros$/, '').trim();
        proj.system.name = curPkg;
        if (!proj.packages[curPkg]) {
          proj.packages[curPkg] = { name: curPkg, artifacts: [] };
        }
        curBlock = null;
        curCompartment = null;
        curTypeSpec = null;
        continue;
      }

      const t0 = tokens[0].replace(/:$/, '');
      if (t0 === 'fromGitRepo' && tokens.length > 1) {
        gitRepo = this.unquote(tokens.slice(1).join(' '));
        if (proj.packages[curPkg]) {
          proj.packages[curPkg].fromGitRepo = gitRepo;
        }
        continue;
      }

      if (t0 === 'msgs') {
        curBlock = 'msgs';
        curCompartment = null;
        curTypeSpec = null;
        continue;
      }
      if (t0 === 'srvs') {
        curBlock = 'srvs';
        curCompartment = null;
        curTypeSpec = null;
        continue;
      }
      if (t0 === 'actions') {
        curBlock = 'actions';
        curCompartment = null;
        curTypeSpec = null;
        continue;
      }

      if (t0 === 'message') {
        curCompartment = 'message';
        continue;
      }
      if (t0 === 'request') {
        curCompartment = 'request';
        continue;
      }
      if (t0 === 'response') {
        curCompartment = 'response';
        continue;
      }
      if (t0 === 'goal') {
        curCompartment = 'goal';
        continue;
      }
      if (t0 === 'result') {
        curCompartment = 'result';
        continue;
      }
      if (t0 === 'feedback') {
        curCompartment = 'feedback';
        continue;
      }

      // Specification name (e.g. Pose or Kill or FollowPath)
      if (tokens.length === 1 && !tokens[0].includes('=') && curBlock) {
        const specName = this.unquote(tokens[0].replace(/:$/, ''));
        const cat = curBlock === 'msgs' ? 'msg' : curBlock === 'srvs' ? 'srv' : 'action';
        const typePkg = curPkg || proj.system.name || cleanFileName || 'ros_package';
        curCompartment = null;
        curTypeSpec = {
          name: specName,
          category: cat,
          pkg: typePkg,
          fields: {},
          line: lineNo,
        };
        if (!proj.system.name) {
          proj.system.name = typePkg;
        }
        proj.types[`${typePkg}.${specName}`] = curTypeSpec;
        continue;
      }

      // Fields/Constants inside a compartment
      if (curCompartment && curTypeSpec) {
        if (!curTypeSpec.fields) curTypeSpec.fields = {};
        if (!curTypeSpec.fields[curCompartment]) curTypeSpec.fields[curCompartment] = [];

        for (let j = 0; j < tokens.length; j += 2) {
          const typeToken = tokens[j];
          const dataToken = tokens[j + 1];
          if (!typeToken || !dataToken) break;

          const isConst = dataToken.includes('=');
          let fName = dataToken;
          let fVal: string | undefined = undefined;
          if (isConst) {
            const eqIdx = dataToken.indexOf('=');
            fName = dataToken.slice(0, eqIdx);
            fVal = dataToken.slice(eqIdx + 1);
          }
          curTypeSpec.fields[curCompartment].push({
            type: typeToken,
            name: this.unquote(fName),
            constant: isConst,
            value: fVal !== undefined ? this.unquote(fVal) : undefined,
            array: typeToken.endsWith('[]'),
          });
        }
      }
    }

    // Convert types to RosNodes and generate dependency connections
    const typeList = Object.values(proj.types);
    for (const spec of typeList) {
      const nodeIfaces: RosInterface[] = [];
      const nodeParams: RosParameter[] = [];

      // Target port so incoming dependency links can attach
      nodeIfaces.push({
        id: `port_${spec.name}_in`,
        name: spec.name,
        label: spec.name,
        kind: 'sub',
        type: spec.name,
        exposed: true,
      });

      for (const fList of Object.values(spec.fields || {})) {
        for (const f of fList) {
          if (f.constant) {
            nodeParams.push({
              id: `p_${spec.name}_${f.name}`,
              name: f.name,
              label: f.name,
              ptype: f.type,
              value: f.value,
              exposed: true,
            });
          } else {
            nodeIfaces.push({
              id: `f_${spec.name}_${f.name}`,
              name: f.name,
              label: f.name,
              kind: 'pub',
              type: f.type,
              exposed: true,
            });
          }
        }
      }

      proj.nodes.push({
        id: `type_${spec.name}`,
        label: spec.name,
        pkg: spec.pkg,
        backing: 'type',
        typeCategory: spec.category,
        typeSpec: spec,
        ifaces: nodeIfaces,
        params: nodeParams,
      });
    }

    // Connect nested type dependencies
    for (const node of proj.nodes) {
      const spec = node.typeSpec;
      if (!spec || !spec.fields) continue;

      for (const fList of Object.values(spec.fields)) {
        for (const f of fList) {
          if (f.constant) continue;
          // Check if field type references another type in proj.nodes
          // e.g. "geometry_msgs/msg/Point" -> "Point", or "'actionlib_msgs/msg/GoalID'" -> "GoalID"
          const cleanType = f.type.replace(/\[\]$/, '').replace(/^['"]|['"]$/g, '');
          const baseTypeName = cleanType.split('/').pop()?.split('.').pop() || cleanType;
          const targetNode = proj.nodes.find((n) => n.label === baseTypeName && n.id !== node.id);
          if (targetNode) {
            proj.connections.push({
              id: `dep_${node.label}_${f.name}_${targetNode.label}`,
              from: { n: node.id, i: `f_${node.label}_${f.name}` },
              to: { n: targetNode.id, i: `port_${targetNode.label}_in` },
            });
          }
        }
      }
    }

    return proj;
  },

  /**
   * Generic entry point to parse any RosTooling model file by extension
   */
  parse(content: string, fileName: string): RosProject {
    if (fileName.endsWith('.rossystem')) {
      return this.parseRosSystem(content, fileName);
    } else if (fileName.endsWith('.ros2') || fileName.endsWith('.ros1')) {
      return this.parseRos2(content, fileName);
    } else if (fileName.endsWith('.ros')) {
      return this.parseRos(content, fileName);
    } else {
      return this.parseRosSystem(content, fileName);
    }
  },
};
