import {
  RosProject,
  RosInteractionKind,
  RosTypeSpec,
} from './RosModelTypes';

const KIND_TO_BLOCK: Record<RosInteractionKind, string> = {
  pub: 'publishers',
  sub: 'subscribers',
  ss: 'serviceservers',
  sc: 'serviceclients',
  as: 'actionservers',
  ac: 'actionclients',
  param: 'parameters',
};

const KIND_ORDER: RosInteractionKind[] = ['pub', 'sub', 'ss', 'sc', 'as', 'ac'];

export const RosModelEmitter = {
  qDouble(s: unknown): string {
    let str = String(s == null ? '' : s).trim();
    if ((str.startsWith('"') && str.endsWith('"')) || (str.startsWith("'") && str.endsWith("'"))) {
      str = str.slice(1, -1);
    }
    // Clean any previous duplicate backslash escapes
    str = str.replace(/\\\\/g, '\\').replace(/\\"/g, '"');
    // Double quote format
    str = str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return '"' + str + '"';
  },

  qSingle(s: unknown): string {
    let str = String(s == null ? '' : s).trim();
    if ((str.startsWith("'") && str.endsWith("'")) || (str.startsWith('"') && str.endsWith('"'))) {
      str = str.slice(1, -1);
    }
    if (str.includes("'") || str.includes('\\')) {
      return this.qDouble(str);
    }
    return "'" + str + "'";
  },

  formatParamValue(ptype = 'String', value: unknown): string {
    const type = (ptype || 'String').trim();
    const raw = value === undefined || value === null ? '' : String(value);

    if (type === 'Boolean') {
      return /^true|1|yes$/i.test(raw.trim()) ? 'true' : 'false';
    }
    if (type === 'Integer') {
      const num = parseInt(raw, 10);
      return isNaN(num) ? '0' : String(num);
    }
    if (type === 'Double') {
      let f = parseFloat(raw);
      if (isNaN(f)) f = 0.0;
      let s = String(f);
      if (!s.includes('.') && !s.includes('e') && !s.includes('E')) {
        s += '.0';
      }
      return s;
    }
    return this.qDouble(raw);
  },

  formatQosValue(key: string, value: unknown): string {
    let str = String(value == null ? '' : value).trim();
    if ((str.startsWith('"') && str.endsWith('"')) || (str.startsWith("'") && str.endsWith("'"))) {
      str = str.slice(1, -1);
    }
    const bareKeys = ['profile', 'history', 'depth', 'reliability', 'durability', 'liveliness'];
    if (bareKeys.includes(key.toLowerCase()) || str === 'infinite' || /^\d+$/.test(str)) {
      return str;
    }
    return `"${str}"`;
  },

  formatKey(s: unknown): string {
    let str = String(s == null ? '' : s).trim();
    if ((str.startsWith('"') && str.endsWith('"')) || (str.startsWith("'") && str.endsWith("'"))) {
      str = str.slice(1, -1);
    }
    // Valid unquoted identifier in Xtext/YAML: alphanumeric, underscores, and dashes only
    if (/^[a-zA-Z0-9_-]+$/.test(str)) {
      return str;
    }
    // Any non-conventional characters (slashes, dots, colons, spaces, etc.) are safely double-quoted
    return this.qDouble(str);
  },

  /**
   * Emit a formatted .rossystem document adhering strictly to RosSystem.xtext grammar
   */
  emitRosSystem(project: RosProject): string {
    const lines: string[] = [];

    // Header comments
    const headerComments = project.system.comments?.header;
    if (Array.isArray(headerComments)) {
      for (const h of headerComments) {
        lines.push(`# ${String(h)}`);
      }
    }

    // System name header
    const sysName = project.system.name || 'ros_system';
    lines.push(`${this.formatKey(sysName)}:`);

    // fromFile (System.fromFile, RosSystem.xtext:34)
    if (project.system.fromFile) {
      lines.push(`  fromFile: ${this.qDouble(project.system.fromFile)}`);
    }

    // subSystems: components+=SubSystem* (RosSystem.xtext:47-49)
    if (project.subSystems && project.subSystems.length > 0) {
      lines.push('  subSystems:');
      for (const sub of project.subSystems) {
        const beforeComments = sub.comments?.before;
        if (Array.isArray(beforeComments)) {
          for (const c of beforeComments) {
            lines.push(`    # ${String(c)}`);
          }
        }
        lines.push(`    ${this.formatKey(sub.ref)}`);
      }
    }

    // nodes: components+=RosNode* (RosSystem.xtext:60-75)
    const localNodes = (project.nodes || []).filter((n) => n.backing !== 'sub' && !n.subRef);
    if (localNodes.length > 0) {
      lines.push('  nodes:');
      for (const node of localNodes) {
        const beforeComments = node.comments?.before;
        if (Array.isArray(beforeComments)) {
          for (const c of beforeComments) {
            lines.push(`    # ${String(c)}`);
          }
        }
        lines.push(`    ${this.formatKey(node.label)}:`);

        if (node.from) {
          lines.push(`      from: ${this.qDouble(node.from)}`);
        }
        if (node.namespace) {
          lines.push(`      namespace: ${this.qDouble(node.namespace)}`);
        }

        // Interfaces (exposures with Xtext arrow: pub-> / sub-> / ss-> / sc-> / as-> / ac->)
        const exposedIfaces = (node.ifaces || []).filter((f) => f.exposed !== false);
        if (exposedIfaces.length > 0) {
          lines.push('      interfaces:');
          for (const iface of exposedIfaces) {
            const expLabel = iface.label || iface.name;
            const targetRef = node.artifact ? `${node.artifact}::${iface.name}` : iface.name;
            const kindArrow = `${iface.kind || 'pub'}->`;
            lines.push(`        - ${this.formatKey(expLabel)}: ${kindArrow} ${this.qDouble(targetRef)}`);
          }
        }

        // Node Parameters: '-' name=EString ':' from=[ros::Parameter|EString] / 'value:' value=ParameterValue
        const exposedParams = (node.params || []).filter((p) => p.exposed !== false);
        if (exposedParams.length > 0) {
          lines.push('      parameters:');
          for (const param of exposedParams) {
            const expLabel = param.label || param.name;
            const targetRef = node.artifact ? `${node.artifact}::${param.name}` : param.name;
            lines.push(`        - ${this.formatKey(expLabel)}: ${this.qDouble(targetRef)}`);
            if (param.sysValue !== undefined && param.sysValue !== null && param.sysValue !== '') {
              lines.push(`          value: ${this.formatParamValue(param.ptype, param.sysValue)}`);
            }
          }
        }
      }
    }

    // connections: connections+=RosSystemConnection* (RosSystem.xtext:85-88)
    if (project.connections && project.connections.length > 0) {
      lines.push('  connections:');
      for (const conn of project.connections) {
        const fromNode = (project.nodes || []).find((n) => n.id === conn.from.n);
        const toNode = (project.nodes || []).find((n) => n.id === conn.to.n);
        const fromIface = fromNode?.ifaces?.find((f) => f.id === conn.from.i);
        const toIface = toNode?.ifaces?.find((f) => f.id === conn.to.i);

        if (fromNode && toNode && fromIface && toIface) {
          const fromName = fromIface.label || fromIface.name;
          const toName = toIface.label || toIface.name;
          // Format as bracketed connection pair [from, to]
          lines.push(`    - [${this.qDouble(fromName)}, ${this.qDouble(toName)}]`);
        }
      }
    }

    // processes: processes+=Process* (RosSystem.xtext:51-58)
    if (project.processes && project.processes.length > 0) {
      lines.push('  processes:');
      for (const proc of project.processes) {
        const beforeComments = proc.comments?.before;
        if (Array.isArray(beforeComments)) {
          for (const c of beforeComments) {
            lines.push(`    # ${String(c)}`);
          }
        }
        lines.push(`    ${this.formatKey(proc.name)}:`);
        if (proc.nodes && proc.nodes.length > 0) {
          const nodesStr = proc.nodes.map((n) => this.formatKey(n)).join(', ');
          lines.push(`      nodes: [ ${nodesStr} ]`);
        }
        if (proc.threads != null) {
          lines.push(`      threads: ${proc.threads}`);
        }
      }
    }

    return lines.join('\n') + '\n';
  },

  /**
   * Emit a formatted .ros2 or .ros1 package definition adhering strictly to Ros2.xtext / Ros.xtext
   */
  emitRos2(project: RosProject, pkgName?: string): string {
    const lines: string[] = [];
    const pkg = (pkgName && project.packages[pkgName]) || Object.values(project.packages)[0] || {
      name: project.system.name.replace(/_system$/, '') || 'ros_package',
      artifacts: [],
    };

    // Ensure pkg.artifacts contains all nodes from project.nodes
    if (!pkg.artifacts) pkg.artifacts = [];
    for (const node of project.nodes) {
      const artName = node.artifact || node.label;
      const existingArt = pkg.artifacts.find((a) => a.name === artName || a.node === node.label);
      if (!existingArt) {
        pkg.artifacts.push({
          name: artName,
          node: node.label,
          ifaces: node.ifaces || [],
          params: node.params || [],
        });
      } else {
        existingArt.ifaces = node.ifaces;
        existingArt.params = node.params;
        existingArt.node = node.label;
      }
    }

    lines.push(`${this.formatKey(pkg.name)}:`);
    if (pkg.fromGitRepo) {
      lines.push(`  fromGitRepo: ${this.qDouble(pkg.fromGitRepo)}`);
    }

    lines.push('  artifacts:');
    for (const art of pkg.artifacts || []) {
      lines.push(`    ${this.formatKey(art.name)}:`);
      lines.push(`      node: ${this.formatKey(art.node || art.name)}`);

      // Group interfaces by kind
      for (const kind of KIND_ORDER) {
        const blockName = KIND_TO_BLOCK[kind];
        const ifacesOfKind = (art.ifaces || []).filter((f) => f.kind === kind);
        if (ifacesOfKind.length > 0) {
          lines.push(`      ${blockName}:`);
          for (const iface of ifacesOfKind) {
            lines.push(`        ${this.formatKey(iface.name)}:`);
            if (iface.type) {
              lines.push(`          type: ${this.qSingle(iface.type)}`);
            }
            if (iface.qos && Object.keys(iface.qos).length > 0) {
              lines.push('          qos:');
              for (const [k, v] of Object.entries(iface.qos)) {
                lines.push(`            ${k}: ${this.formatQosValue(k, v)}`);
              }
            }
          }
        }
      }

      // Parameters
      const params = art.params || [];
      if (params.length > 0) {
        lines.push('      parameters:');
        for (const p of params) {
          lines.push(`        ${this.formatKey(p.name)}:`);
          lines.push(`          type: ${p.ptype || 'String'}`);
          if (p.value !== undefined && p.value !== null && p.value !== '') {
            lines.push(`          default: ${this.formatParamValue(p.ptype, p.value)}`);
          }
        }
      }
    }

    return lines.join('\n') + '\n';
  },

  formatRosType(type: string): string {
    const isArray = type.endsWith('[]');
    let base = isArray ? type.slice(0, -2) : type;
    if ((base.startsWith("'") && base.endsWith("'")) || (base.startsWith('"') && base.endsWith('"'))) {
      base = base.slice(1, -1);
    }
    if (base.includes('/') || base.includes('.')) {
      return `'${base}'${isArray ? '[]' : ''}`;
    }
    return `${base}${isArray ? '[]' : ''}`;
  },

  /**
   * Emit a formatted .ros document (ROS Communication Objects) adhering strictly to Ros.xtext grammar
   */
  emitRos(project: RosProject): string {
    const lines: string[] = [];
    const pkgMap: Record<string, RosTypeSpec[]> = {};

    // Gather types from project.nodes
    for (const node of project.nodes || []) {
      if (node.backing === 'type' && node.typeSpec) {
        const pkgName = node.pkg || project.system.name || 'ros_package';
        if (!pkgMap[pkgName]) pkgMap[pkgName] = [];
        // Keep node.typeSpec synchronized with node.label
        const curSpec = node.typeSpec;
        if (!pkgMap[pkgName].find((s) => s.name === curSpec.name)) {
          pkgMap[pkgName].push(curSpec);
        }
      }
    }

    // Also include any types directly in project.types not already in nodes
    for (const spec of Object.values(project.types || {})) {
      const pkgName = spec.pkg || project.system.name || 'ros_package';
      if (!pkgMap[pkgName]) pkgMap[pkgName] = [];
      if (!pkgMap[pkgName].find((s) => s.name === spec.name)) {
        pkgMap[pkgName].push(spec);
      }
    }

    for (const [pkgName, specs] of Object.entries(pkgMap)) {
      lines.push(`${this.formatKey(pkgName)}:`);

      const msgs = specs.filter((s) => s.category === 'msg');
      const srvs = specs.filter((s) => s.category === 'srv');
      const actions = specs.filter((s) => s.category === 'action');

      if (msgs.length > 0) {
        lines.push('  msgs:');
        for (const m of msgs) {
          lines.push(`    ${this.formatKey(m.name)}`);
          lines.push('      message');
          for (const f of m.fields?.['message'] || []) {
            const formattedType = this.formatRosType(f.type);
            if (f.constant) {
              lines.push(`        ${formattedType} ${f.name}=${f.value ?? ''}`);
            } else {
              lines.push(`        ${formattedType} ${f.name}`);
            }
          }
        }
      }

      if (srvs.length > 0) {
        lines.push('  srvs:');
        for (const s of srvs) {
          lines.push(`    ${this.formatKey(s.name)}`);
          lines.push('      request');
          for (const f of s.fields?.['request'] || []) {
            lines.push(`        ${this.formatRosType(f.type)} ${f.name}`);
          }
          lines.push('      response');
          for (const f of s.fields?.['response'] || []) {
            lines.push(`        ${this.formatRosType(f.type)} ${f.name}`);
          }
        }
      }

      if (actions.length > 0) {
        lines.push('  actions:');
        for (const a of actions) {
          lines.push(`    ${this.formatKey(a.name)}`);
          lines.push('      goal');
          for (const f of a.fields?.['goal'] || []) {
            lines.push(`        ${this.formatRosType(f.type)} ${f.name}`);
          }
          lines.push('      result');
          for (const f of a.fields?.['result'] || []) {
            lines.push(`        ${this.formatRosType(f.type)} ${f.name}`);
          }
          lines.push('      feedback');
          for (const f of a.fields?.['feedback'] || []) {
            lines.push(`        ${this.formatRosType(f.type)} ${f.name}`);
          }
        }
      }
    }

    return lines.join('\n') + '\n';
  },

  /**
   * Generic emit by file extension
   */
  emit(project: RosProject, fileName: string): string {
    if (fileName.endsWith('.rossystem')) {
      return this.emitRosSystem(project);
    } else if (fileName.endsWith('.ros2') || fileName.endsWith('.ros1')) {
      return this.emitRos2(project);
    } else if (fileName.endsWith('.ros')) {
      return this.emitRos(project);
    } else {
      return this.emitRosSystem(project);
    }
  },
};
