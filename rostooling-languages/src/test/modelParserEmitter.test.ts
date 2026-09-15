import * as assert from 'assert';
import { RosModelParser } from '../model/RosModelParser';
import { RosModelEmitter } from '../model/RosModelEmitter';

suite('RosModelParser & Emitter Test Suite', () => {
  const sampleRosSystem = `turtlebot3_navigation:
  fromFile: "turtlebot3_navigation.rossystem"
  subSystems:
    - "turtlebot"
  nodes:
    amcl:
      from: "nav2_amcl.amcl"
      namespace: "/robot1"
      interfaces:
        - "scan_sub": sub-> "amcl::scan"
        - "map_pub": pub-> "amcl::map"
      parameters:
        - "use_sim_time": "amcl::use_sim_time"
          value: false
    map_server:
      from: "nav2_map_server.map_server"
      interfaces:
        - "map_server_pub": pub-> "map_server::map"
  connections:
    - ["map_server_pub", "map_pub"]
`;

  test('Parse .rossystem with subsystems, nodes, interfaces, and connections', () => {
    const project = RosModelParser.parseRosSystem(sampleRosSystem, 'turtlebot3_navigation.rossystem');
    assert.strictEqual(project.system.name, 'turtlebot3_navigation');
    assert.strictEqual(project.system.fromFile, 'turtlebot3_navigation.rossystem');
    assert.strictEqual(project.subSystems.length, 1);
    assert.strictEqual(project.subSystems[0].ref, 'turtlebot');
    assert.strictEqual(project.subSystems[0].state, 'collapsed');
    assert.strictEqual(project.nodes.length, 2);

    const amclNode = project.nodes.find((n) => n.label === 'amcl');
    assert.ok(amclNode);
    assert.strictEqual(amclNode?.namespace, '/robot1');
    assert.strictEqual(amclNode?.ifaces.length, 2);
    assert.strictEqual(amclNode?.ifaces[0].kind, 'sub');
    assert.strictEqual(amclNode?.ifaces[1].kind, 'pub');
    assert.strictEqual(amclNode?.params.length, 1);
    assert.strictEqual(amclNode?.params[0].sysValue, 'false');

    assert.strictEqual(project.connections.length, 1);
  });

  test('Emit .rossystem generates valid indentation and Xtext structure with arrows and bracketed connections', () => {
    const project = RosModelParser.parseRosSystem(sampleRosSystem, 'turtlebot3_navigation.rossystem');
    const emitted = RosModelEmitter.emitRosSystem(project);
    assert.ok(emitted.includes('turtlebot3_navigation:'));
    assert.ok(emitted.includes('subSystems:'));
    assert.ok(emitted.includes('turtlebot'));
    assert.ok(emitted.includes('amcl:'));
    assert.ok(emitted.includes('from: "nav2_amcl.amcl"'));
    assert.ok(emitted.includes('namespace: "/robot1"'));
    assert.ok(emitted.includes('- scan_sub: sub-> "amcl::scan"'));
    assert.ok(emitted.includes('- map_pub: pub-> "amcl::map"'));
    assert.ok(emitted.includes('connections:'));
    assert.ok(emitted.includes('- ["map_server_pub", "map_pub"]'));
  });

  const sampleRos2 = `my_pkg:
  fromGitRepo: "https://github.com/example/my_pkg.git"
  artifacts:
    my_node:
      node: my_node
      publishers:
        scan:
          type: 'sensor_msgs/msg/LaserScan'
      subscribers:
        cmd_vel:
          type: 'geometry_msgs/msg/Twist'
      parameters:
        rate:
          type: Double
          default: 20.0
`;

  test('Parse and emit .ros2 packages', () => {
    const project = RosModelParser.parseRos2(sampleRos2, 'my_pkg.ros2');
    assert.strictEqual(project.nodes.length, 1);
    const node = project.nodes[0];
    assert.strictEqual(node.label, 'my_node');
    assert.strictEqual(node.pkg, 'my_pkg');
    assert.strictEqual(node.ifaces.length, 2);
    assert.strictEqual(node.params.length, 1);
    assert.strictEqual(node.params[0].name, 'rate');

    const emitted = RosModelEmitter.emitRos2(project);
    assert.ok(emitted.includes('my_pkg:'));
    assert.ok(emitted.includes('artifacts:'));
    assert.ok(emitted.includes('publishers:'));
    assert.ok(emitted.includes('scan:'));
    assert.ok(emitted.includes("type: 'sensor_msgs/msg/LaserScan'"));
  });

  test('Preserve collapsed subsystem states in view metadata', () => {
    const multiSubsystemDoc = `my_robot_system:
  subSystems:
    - "navigation"
    - "perception"
  nodes:
    base_node:
      from: "base_pkg.base_node"
      interfaces:
        - "odom_pub": pub-> "base_node::odom"
`;
    const project = RosModelParser.parseRosSystem(multiSubsystemDoc, 'my_robot_system.rossystem');
    assert.strictEqual(project.subSystems.length, 2);
    assert.strictEqual(project.subSystems[0].ref, 'navigation');
    assert.strictEqual(project.subSystems[0].state, 'collapsed');
    assert.strictEqual(project.subSystems[1].ref, 'perception');
    assert.strictEqual(project.subSystems[1].state, 'collapsed');

    const emitted = RosModelEmitter.emitRosSystem(project);
    assert.ok(emitted.includes('my_robot_system:'));
    assert.ok(emitted.includes('navigation'));
    assert.ok(emitted.includes('perception'));
    assert.ok(emitted.includes('base_node:'));
    assert.ok(emitted.includes('- odom_pub: pub-> "base_node::odom"'));
  });

  test('Infer interface kinds accurately when arrow is present or from naming fallback', () => {
    const systemDoc = `test_system:
  nodes:
    node1:
      from: "test_system.image_filter"
      interfaces:
        - "filtered_image_pub": pub-> "image_filter::image_out"
        - "image_sub": sub-> "image_filter::image_in"
        - "laser_sub": sub-> "image_filter::laser_in"
`;
    const project = RosModelParser.parseRosSystem(systemDoc, 'test_system.rossystem');
    const node1 = project.nodes[0];
    assert.strictEqual(node1.ifaces[0].kind, 'pub');
    assert.strictEqual(node1.ifaces[1].kind, 'sub');
    assert.strictEqual(node1.ifaces[2].kind, 'sub');
  });

  test('FormatKey wraps non-conventional characters in double quotes and preserves conventional identifiers', () => {
    const specialRos2 = `my_pkg:
  artifacts:
    my_node:
      node: my_node
      publishers:
        normal_topic:
          type: 'std_msgs/msg/String'
        "/namespaced/scan":
          type: 'sensor_msgs/msg/LaserScan'
        "sensor.temperature":
          type: 'sensor_msgs/msg/Temperature'
      parameters:
        normal_param:
          type: Integer
          default: 10
        "qos_overrides./parameter_events.publisher.depth":
          type: Integer
          default: 1000
`;

    const project = RosModelParser.parseRos2(specialRos2, 'my_pkg.ros2');
    assert.strictEqual(project.nodes[0].ifaces.length, 3);
    assert.strictEqual(project.nodes[0].params.length, 2);

    const emitted = RosModelEmitter.emitRos2(project);
    assert.ok(emitted.includes('normal_topic:'), 'Conventional topic must not be quoted');
    assert.ok(emitted.includes('"/namespaced/scan":'), 'Topic with slashes must be quoted');
    assert.ok(emitted.includes('"sensor.temperature":'), 'Topic with dots must be quoted');
    assert.ok(emitted.includes('normal_param:'), 'Conventional param must not be quoted');
    assert.ok(emitted.includes('"qos_overrides./parameter_events.publisher.depth":'), 'Param with dots and slashes must be quoted');
  });

  test('Preserve expanded subsystem state across model caching and updates', () => {
    const subDoc = `turtlebot3_mapping:
  subSystems:
    turtlebot_gazebo
    cartographer
  nodes:
    rviz2:
      from: "rviz2.rviz2"
`;
    const project = RosModelParser.parseRosSystem(subDoc, 'turtlebot3_mapping.rossystem');
    assert.strictEqual(project.subSystems[0].state, 'collapsed');

    // Simulate expanding subsystem in GUI
    project.subSystems[0].state = 'framed';
    if (!project.view) project.view = {};
    if (!project.view.subStates) project.view.subStates = {};
    project.view.subStates['turtlebot_gazebo'] = 'framed';

    // Simulate parsing fresh text and merging cached view
    const freshProject = RosModelParser.parseRosSystem(subDoc, 'turtlebot3_mapping.rossystem');
    const mergedSubStates = {
      ...(freshProject.view?.subStates || {}),
      ...(project.view.subStates || {}),
    };
    freshProject.view = {
      ...freshProject.view,
      ...project.view,
      subStates: mergedSubStates,
    };
    for (const sub of freshProject.subSystems) {
      if (mergedSubStates[sub.ref]) {
        sub.state = mergedSubStates[sub.ref];
      }
    }

    assert.strictEqual(freshProject.subSystems[0].state, 'framed', 'Expanded state must persist');
  });

  test('Parse empty .ros file with absolute path does not pollute system.name with path', () => {
    const emptyPath = '/home/adm-esa/workspace/test_system/inspection_msgs.ros';
    const parsed = RosModelParser.parseRos('', emptyPath);
    assert.strictEqual(parsed.system.name, '', 'Empty .ros file must have empty system.name');
    assert.strictEqual(parsed.nodes.length, 0);
    assert.strictEqual(Object.keys(parsed.types).length, 0);

    const emitted = RosModelEmitter.emitRos(parsed);
    assert.strictEqual(emitted, '', 'Emitting empty .ros project with empty system.name returns empty string');
  });

  test('emitRos deduplicates types across disparate package keys and sanitizes path-like package names', () => {
    const dirtyPath = '/home/adm-esa/workspace/test_system/inspection_msgs';
    const project = {
      formatVersion: 4,
      isRos: true,
      isRosSystem: false,
      system: { name: 'inspection_msgs' },
      subSystems: [],
      nodes: [
        {
          id: 'type_NewMessage',
          label: 'NewMessage',
          pkg: 'inspection_msgs',
          backing: 'type' as const,
          typeCategory: 'msg' as const,
          typeSpec: {
            name: 'NewMessage',
            category: 'msg' as const,
            pkg: 'inspection_msgs',
            fields: {
              message: [{ type: 'string', name: 'data', constant: false, array: false }],
            },
          },
          ifaces: [],
          params: [],
        },
      ],
      connections: [],
      packages: {},
      types: {
        [`${dirtyPath}.NewMessage`]: {
          name: 'NewMessage',
          category: 'msg' as const,
          pkg: dirtyPath,
          fields: {
            message: [{ type: 'string', name: 'data', constant: false, array: false }],
          },
        },
      },
    };

    const emitted = RosModelEmitter.emitRos(project);

    // Verify it emits ONLY ONE clean package block: inspection_msgs
    const occurrences = (emitted.match(/inspection_msgs:/g) || []).length;
    assert.strictEqual(occurrences, 1, 'inspection_msgs package header must occur exactly once');
    assert.ok(!emitted.includes('/home/adm-esa'), 'Must not emit absolute file path as package name');
    assert.ok(!emitted.includes('"'), 'Must not quote package header');
    assert.ok(emitted.includes('msgs:'));
    assert.ok(emitted.includes('NewMessage'));
    assert.ok(emitted.includes('string data'));

    // Round-trip parse to verify correctness
    const roundTripped = RosModelParser.parseRos(emitted, 'inspection_msgs.ros');
    assert.strictEqual(roundTripped.system.name, 'inspection_msgs');
    assert.strictEqual(roundTripped.nodes.length, 1);
  });
});
