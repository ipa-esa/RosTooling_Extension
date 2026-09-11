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
});
