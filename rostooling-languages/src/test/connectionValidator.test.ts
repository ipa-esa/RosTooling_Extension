import * as assert from 'assert';
import { ConnectionValidator } from '../model/ConnectionValidator';
import { RosNode, RosProject } from '../model/RosModelTypes';

suite('ConnectionValidator Test Suite', () => {
  const node1: RosNode = {
    id: 'n1',
    label: 'sensor_node',
    ifaces: [
      { id: 'i1', name: 'scan_pub', kind: 'pub', type: 'sensor_msgs/msg/LaserScan', exposed: true },
      { id: 'i2', name: 'srv_server', kind: 'ss', type: 'std_srvs/srv/SetBool', exposed: true },
      { id: 'i3', name: 'act_server', kind: 'as', type: 'nav2_msgs/action/NavigateToPose', exposed: true }
    ],
    params: []
  };

  const node2: RosNode = {
    id: 'n2',
    label: 'planner_node',
    ifaces: [
      { id: 'i4', name: 'scan_sub', kind: 'sub', type: 'sensor_msgs/msg/LaserScan', exposed: true },
      { id: 'i5', name: 'odom_sub', kind: 'sub', type: 'nav_msgs/msg/Odometry', exposed: true },
      { id: 'i6', name: 'srv_client', kind: 'sc', type: 'std_srvs/srv/SetBool', exposed: true },
      { id: 'i7', name: 'act_client', kind: 'ac', type: 'nav2_msgs/action/NavigateToPose', exposed: true },
      { id: 'i8', name: 'pub_duplicate', kind: 'pub', type: 'sensor_msgs/msg/LaserScan', exposed: true }
    ],
    params: []
  };

  test('Valid publisher to subscriber connection with matching type', () => {
    const res = ConnectionValidator.validate(node1, node1.ifaces[0], node2, node2.ifaces[0]);
    assert.strictEqual(res.valid, true);
    assert.strictEqual(res.normalizedFrom?.n, 'n1');
    assert.strictEqual(res.normalizedTo?.n, 'n2');
  });

  test('Valid subscriber to publisher dragged in reverse (auto-oriented)', () => {
    const res = ConnectionValidator.validate(node2, node2.ifaces[0], node1, node1.ifaces[0]);
    assert.strictEqual(res.valid, true);
    assert.strictEqual(res.normalizedFrom?.n, 'n1');
    assert.strictEqual(res.normalizedTo?.n, 'n2');
  });

  test('Disallow connection between identical kinds (pub -> pub)', () => {
    const res = ConnectionValidator.validate(node1, node1.ifaces[0], node2, node2.ifaces[4]);
    assert.strictEqual(res.valid, false);
    assert.ok(res.reason?.includes('Incompatible kinds'));
  });

  test('Disallow connection with mismatched message types', () => {
    const res = ConnectionValidator.validate(node1, node1.ifaces[0], node2, node2.ifaces[1]);
    assert.strictEqual(res.valid, false);
    assert.ok(res.reason?.includes('Type mismatch'));
  });

  test('Disallow self-connection on the same node', () => {
    const res = ConnectionValidator.validate(node1, node1.ifaces[0], node1, node1.ifaces[0]);
    assert.strictEqual(res.valid, false);
    assert.ok(res.reason?.includes('Cannot connect node "sensor_node" to itself'));
  });

  test('Valid Service Client to Service Server connection', () => {
    const res = ConnectionValidator.validate(node2, node2.ifaces[2], node1, node1.ifaces[1]);
    assert.strictEqual(res.valid, true);
  });

  test('Valid Action Client to Action Server connection', () => {
    const res = ConnectionValidator.validate(node2, node2.ifaces[3], node1, node1.ifaces[2]);
    assert.strictEqual(res.valid, true);
  });

  test('Live HUD tooltip generation provides clear feedback', () => {
    const validHud = ConnectionValidator.getDragStatusHUD(node1, node1.ifaces[0], node2, node2.ifaces[0]);
    assert.strictEqual(validHud.status, 'valid');
    assert.ok(validHud.text.includes('Connect to'));

    const invalidHud = ConnectionValidator.getDragStatusHUD(node1, node1.ifaces[0], node2, node2.ifaces[1]);
    assert.strictEqual(invalidHud.status, 'invalid');
    assert.ok(invalidHud.text.toLowerCase().includes('type mismatch'));
  });

  test('getCompatiblePortKeys finds only matching legal targets', () => {
    const proj: RosProject = {
      formatVersion: 4,
      system: { name: 'test_sys' },
      subSystems: [],
      nodes: [node1, node2],
      connections: [],
      packages: {},
      types: {}
    };

    const legalKeys = ConnectionValidator.getCompatiblePortKeys(node1, node1.ifaces[0], proj);
    assert.strictEqual(legalKeys.has('n2:i4'), true);
    assert.strictEqual(legalKeys.has('n2:i5'), false);
    assert.strictEqual(legalKeys.has('n2:i8'), false);
  });

  test('Tiered matching: Tier 1 Intentional Remapping Match', () => {
    // Both ports remapped via studio portBindings or labels to "shared_vel"
    const srcNode = { id: 'teleop', label: 'teleop_twist_keyboard' };
    const srcIface = { id: 'cmd_out', name: 'cmd_vel_raw', label: 'cmd_out' };
    const tgtNode = { id: 'base', label: 'differential_drive_base' };
    const tgtIface = { id: 'cmd_in', name: 'raw_cmd', label: 'cmd_in' };

    const proj = {
      studio: {
        modules: {
          teleop: { portBindings: { cmd_out: 'shared_vel' } },
          base: { portBindings: { cmd_in: 'shared_vel' } },
        },
      },
    };

    const match = ConnectionValidator.portsMatch(srcNode, srcIface, tgtNode, tgtIface, proj);
    assert.strictEqual(match.matched, true);
    assert.strictEqual(match.tier, 'remap');
    assert.strictEqual(match.resolvedName, 'shared_vel');
  });

  test('Tiered matching: Tier 2 Directed Remapping Match', () => {
    // Target port is remapped explicitly to target source port base name "scan"
    const srcNode = { id: 'lidar', label: 'laser_sensor' };
    const srcIface = { id: 'scan_out', name: 'scan', label: 'laser_scan_pub' };
    const tgtNode = { id: 'amcl', label: 'amcl_localization' };
    const tgtIface = { id: 'scan_in', name: 'laser_input', label: 'scan' }; // label remapped to "scan"

    const match = ConnectionValidator.portsMatch(srcNode, srcIface, tgtNode, tgtIface);
    assert.strictEqual(match.matched, true);
    assert.strictEqual(match.tier, 'directed-remap');
    assert.strictEqual(match.resolvedName, 'scan');
  });

  test('Tiered matching: Tier 3 Underlying Contract Match', () => {
    // Component instance port alias labels differ ("filtered_image_pub" vs "filtered_image_sub"),
    // but underlying ROS contract interface name is identical ("filtered_image")
    const srcNode = { id: 'filter', label: 'image_filter_node' };
    const srcIface = { id: 'p1', name: 'filtered_image', label: 'filtered_image_pub' };
    const tgtNode = { id: 'detect', label: 'object_detector_node' };
    const tgtIface = { id: 'p2', name: 'filtered_image', label: 'filtered_image_sub' };

    const match = ConnectionValidator.portsMatch(srcNode, srcIface, tgtNode, tgtIface);
    assert.strictEqual(match.matched, true);
    assert.strictEqual(match.tier, 'contract');
    assert.strictEqual(match.resolvedName, 'filtered_image');
  });

  test('autoConnectMatching automatically wires compatible ports and prevents duplicate connections', () => {
    const pubNode: RosNode = {
      id: 'n_pub',
      label: 'publisher_node',
      ifaces: [
        { id: 'p_img', name: 'camera/image_raw', label: 'cam_pub', kind: 'pub', type: 'sensor_msgs/msg/Image', exposed: true },
      ],
      params: [],
    };
    const subNode: RosNode = {
      id: 'n_sub',
      label: 'subscriber_node',
      ifaces: [
        { id: 's_img', name: 'camera/image_raw', label: 'cam_sub', kind: 'sub', type: 'sensor_msgs/msg/Image', exposed: true },
      ],
      params: [],
    };

    const proj: RosProject = {
      formatVersion: 4,
      system: { name: 'cam_sys' },
      subSystems: [],
      nodes: [pubNode, subNode],
      connections: [],
      packages: {},
      types: {},
    };

    const skipped: string[] = [];
    const connected: string[] = [];
    const res1 = ConnectionValidator.autoConnectMatching(proj, skipped, connected);

    assert.strictEqual(res1.connectionsAdded, 1);
    assert.strictEqual(proj.connections.length, 1);
    assert.strictEqual(proj.connections[0].from.n, 'n_pub');
    assert.strictEqual(proj.connections[0].to.n, 'n_sub');
    assert.strictEqual(connected.length, 1);
    assert.ok(connected[0].includes('contract'));

    // Second run should NOT duplicate existing connection
    const skipped2: string[] = [];
    const connected2: string[] = [];
    const res2 = ConnectionValidator.autoConnectMatching(proj, skipped2, connected2);
    assert.strictEqual(res2.connectionsAdded, 0);
    assert.strictEqual(proj.connections.length, 1);
  });
});
