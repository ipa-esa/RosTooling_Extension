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
            const artName = node.artifact || (node.from && node.from.includes('.') ? node.from.split('.')[1] : undefined);
            const targetRef = artName ? `${artName}::${iface.name}` : iface.name;
            const kindArrow = `${iface.kind || 'pub'}->`;
            lines.push(`        - ${this.formatKey(expLabel)}: ${kindArrow} ${this.qDouble(targetRef)}`);
          }
        }

        // Node Parameters: '-' name=EString ':' from=[ros::Parameter|EString] / 'value:' value=ParameterValue
        // RosSystem.xtext requires 'value:' for any parameter emitted in .rossystem.
        // Omit parameters that have no value assigned.
        const exposedParams = (node.params || []).filter((p) => {
          if (p.exposed === false) return false;
          const val = (p.sysValue !== undefined && p.sysValue !== null && String(p.sysValue).trim() !== '')
            ? p.sysValue
            : (p.value !== undefined && p.value !== null && String(p.value).trim() !== '' ? p.value : null);
          return val !== null;
        });
        if (exposedParams.length > 0) {
          lines.push('      parameters:');
          for (const param of exposedParams) {
            const expLabel = param.label || param.name;
            const artName = node.artifact || (node.from && node.from.includes('.') ? node.from.split('.')[1] : undefined);
            const targetRef = artName ? `${artName}::${param.name}` : param.name;
            const val = (param.sysValue !== undefined && param.sysValue !== null && String(param.sysValue).trim() !== '')
              ? param.sysValue
              : (param.value ?? '');
            lines.push(`        - ${this.formatKey(expLabel)}: ${this.qDouble(targetRef)}`);
            lines.push(`          value: ${this.formatParamValue(param.ptype, val)}`);
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
        const fromIface = fromNode?.ifaces?.find(
          (f) => f.id === conn.from.i || f.label === conn.from.i || f.name === conn.from.i
        );
        const toIface = toNode?.ifaces?.find(
          (f) => f.id === conn.to.i || f.label === conn.to.i || f.name === conn.to.i
        );

        let fromName = fromIface ? (fromIface.label || fromIface.name) : '';
        let toName = toIface ? (toIface.label || toIface.name) : '';

        if (!fromName && conn.rawFrom) fromName = conn.rawFrom;
        if (!toName && conn.rawTo) toName = conn.rawTo;

        if (!fromName && conn.from?.i) {
          const fallback = (project.nodes || []).flatMap((n) => n.ifaces || []).find(
            (f) => f.id === conn.from.i || f.label === conn.from.i || f.name === conn.from.i
          );
          fromName = fallback ? (fallback.label || fallback.name) : conn.from.i;
        }
        if (!toName && conn.to?.i) {
          const fallback = (project.nodes || []).flatMap((n) => n.ifaces || []).find(
            (f) => f.id === conn.to.i || f.label === conn.to.i || f.name === conn.to.i
          );
          toName = fallback ? (fallback.label || fallback.name) : conn.to.i;
        }

        if (fromName && toName) {
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

    const fallbackPkgName = (project.system?.name || '')
      .replace(/_system$/, '')
      .replace(/^.*[\\/]/, '')
      .replace(/\.ros2$/, '')
      .replace(/\.ros1$/, '')
      .trim();

    const nonDefaultNodePkg = (project.nodes || []).find((n) => n.pkg && n.pkg !== 'ros_package')?.pkg;
    const anyNodePkg = (project.nodes || []).find((n) => n.pkg)?.pkg;
    const determinedPkgName =
      (pkgName && pkgName !== 'ros_package' ? pkgName : '') ||
      nonDefaultNodePkg ||
      (fallbackPkgName && fallbackPkgName !== 'package' && fallbackPkgName !== 'ros_package' ? fallbackPkgName : '') ||
      anyNodePkg ||
      (pkgName ? project.packages[pkgName]?.name : '') ||
      Object.values(project.packages)[0]?.name ||
      fallbackPkgName ||
      'ros_package';

    const cleanPkgName = determinedPkgName
      .replace(/^.*[\\/]/, '')
      .replace(/\.ros2$/, '')
      .replace(/\.ros1$/, '')
      .trim() || 'ros_package';

    let pkg = (pkgName && project.packages[pkgName]) || project.packages[cleanPkgName] || Object.values(project.packages)[0];
    if (!pkg) {
      pkg = {
        name: cleanPkgName,
        artifacts: [],
      };
    } else {
      pkg.name = cleanPkgName;
    }

    // Build active artifacts list strictly aligned with project.nodes
    const activeArtifacts: typeof pkg.artifacts = [];
    for (const node of project.nodes || []) {
      if (node.backing === 'type') continue;
      const artName = node.artifact || node.label;
      const existingArt = (pkg.artifacts || []).find(
        (a) => a.name === artName || (node.label && a.node === node.label)
      );
      if (existingArt) {
        existingArt.name = artName;
        existingArt.node = node.label;
        existingArt.ifaces = node.ifaces;
        existingArt.params = node.params;
        activeArtifacts.push(existingArt);
      } else {
        activeArtifacts.push({
          name: artName,
          node: node.label,
          ifaces: node.ifaces || [],
          params: node.params || [],
        });
      }
    }
    pkg.artifacts = activeArtifacts;

    lines.push(`${this.formatKey(cleanPkgName)}:`);
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
              const validEntries = Object.entries(iface.qos).filter(([, v]) => v != null && String(v).trim() !== '');
              if (validEntries.length > 0) {
                lines.push('          qos:');
                for (const [k, v] of validEntries) {
                  lines.push(`            ${k}: ${this.formatQosValue(k, v)}`);
                }
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

    // Sanitize project.system.name fallback
    const fallbackPkg = (project.system?.name || '')
      .replace(/^.*[\\/]/, '')
      .replace(/\.ros$/, '')
      .trim();

    const sanitizePkg = (p?: string): string => {
      if (!p) return fallbackPkg || 'ros_package';
      const clean = p.replace(/^.*[\\/]/, '').replace(/\.ros$/, '').trim();
      return clean || fallbackPkg || 'ros_package';
    };

    const seenTypeNames = new Set<string>();

    // Gather types from project.nodes
    for (const node of project.nodes || []) {
      if (node.backing === 'type' && node.typeSpec) {
        const pkgName = sanitizePkg(node.pkg || fallbackPkg);
        if (!pkgMap[pkgName]) pkgMap[pkgName] = [];
        const curSpec = node.typeSpec;
        const typeName = node.label || curSpec.name;
        curSpec.name = typeName;
        curSpec.pkg = pkgName;
        if (!seenTypeNames.has(typeName)) {
          seenTypeNames.add(typeName);
          pkgMap[pkgName].push(curSpec);
        }
      }
    }

    const hasTypeNodes = (project.nodes || []).some((n) => n.backing === 'type');
    const defaultTemplateNames = new Set(['NewMessage', 'NewService', 'NewAction']);

    // Also include any types directly in project.types not already in nodes
    for (const spec of Object.values(project.types || {})) {
      if (!spec || !spec.name) continue;
      // If type nodes exist, skip orphaned default templates from project.types
      if (hasTypeNodes && defaultTemplateNames.has(spec.name)) {
        continue;
      }
      if (!seenTypeNames.has(spec.name)) {
        const pkgName = sanitizePkg(spec.pkg || fallbackPkg);
        if (!pkgMap[pkgName]) pkgMap[pkgName] = [];
        spec.pkg = pkgName;
        seenTypeNames.add(spec.name);
        pkgMap[pkgName].push(spec);
      }
    }

    if (Object.keys(pkgMap).length === 0) {
      if (fallbackPkg) {
        return `${this.formatKey(fallbackPkg)}:\n`;
      }
      return '';
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
