import * as assert from 'assert';
import * as path from 'path';
import { LspValidator, LspDiagnostic } from './LspValidator';
import { RosModelParser } from '../model/RosModelParser';
import { RosModelEmitter } from '../model/RosModelEmitter';
import { RosProject } from '../model/RosModelTypes';

suite('LSP Protocol Model Validation Test Suite', () => {
  let lspValidator: LspValidator;
  const extensionRoot = path.resolve(__dirname, '..', '..');

  suiteSetup(async function () {
    this.timeout(15000);
    lspValidator = new LspValidator(extensionRoot);
    await lspValidator.init();
  });

  suiteTeardown(() => {
    if (lspValidator) {
      lspValidator.stop();
    }
  });

  function getSyntaxErrors(diags: LspDiagnostic[]): LspDiagnostic[] {
    return diags.filter(
      (d) =>
        d.severity === 1 &&
        (d.code?.includes('Syntax') ||
          d.message.includes('mismatched input') ||
          d.message.includes('no viable alternative') ||
          d.message.includes('extraneous input'))
    );
  }

  test('Validate .ros2 model with QualityOfService blocks against Xtext Ros2Validator via LSP', async function () {
    this.timeout(10000);

    // Project created/modified via GUI
    const guiRos2Project: RosProject = {
      formatVersion: 4,
      system: { name: 'camera_driver_system', comments: {} },
      subSystems: [],
      nodes: [
        {
          id: 'n_camera_node',
          label: 'camera_node',
          pkg: 'camera_driver',
          artifact: 'camera_driver',
          from: 'camera_driver.camera_driver',
          backing: 'local',
          ifaces: [
            {
              id: 'i_camera_node_image_raw',
              name: 'image_raw',
              label: 'image_raw',
              kind: 'pub',
              type: 'sensor_msgs/msg/Image',
              qos: {
                profile: 'sensor_qos',
                reliability: 'best_effort',
                durability: 'volatile',
                history: 'keep_last',
                depth: '10',
              },
              exposed: true,
            },
            {
              id: 'i_camera_node_camera_info',
              name: 'camera_info',
              label: 'camera_info',
              kind: 'pub',
              type: 'sensor_msgs/msg/CameraInfo',
              exposed: true,
            },
            {
              id: 'i_camera_node_set_camera_info',
              name: 'set_camera_info',
              label: 'set_camera_info',
              kind: 'ss',
              type: 'sensor_msgs/srv/SetCameraInfo',
              exposed: true,
            },
          ],
          params: [
            {
              id: 'p_camera_node_frame_id',
              name: 'frame_id',
              label: 'frame_id',
              ptype: 'String',
              value: 'camera_optical_frame',
              exposed: true,
            },
            {
              id: 'p_camera_node_fps',
              name: 'fps',
              label: 'fps',
              ptype: 'Double',
              value: '30.0',
              exposed: true,
            },
          ],
        },
      ],
      connections: [],
      packages: {},
      types: {},
      view: { tx: 40, ty: 40, k: 1, level: 3 },
    };

    // Emit using our strictly compliant Xtext emitter
    const emittedRos2 = RosModelEmitter.emitRos2(guiRos2Project, 'camera_driver');

    // Assert that QoS values have NO single quotes in emitted string
    assert.ok(emittedRos2.includes('profile: sensor_qos'));
    assert.ok(emittedRos2.includes('reliability: best_effort'));
    assert.ok(emittedRos2.includes('durability: volatile'));
    assert.ok(emittedRos2.includes('history: keep_last'));
    assert.ok(emittedRos2.includes('depth: 10'));
    assert.ok(!emittedRos2.includes("'sensor_qos'"));
    assert.ok(!emittedRos2.includes("'best_effort'"));

    // Send to authentic Xtext Language Server via LSP protocol
    const diags = await lspValidator.validate(
      'file:///tmp/camera_driver.ros2',
      'ros2',
      emittedRos2
    );

    const syntaxErrors = getSyntaxErrors(diags);
    assert.strictEqual(
      syntaxErrors.length,
      0,
      `Expected 0 syntax errors from LSP, got: ${JSON.stringify(syntaxErrors, null, 2)}`
    );
  });

  test('Validate .rossystem model with interface arrows & connections against Xtext RosSystemValidator via LSP', async function () {
    this.timeout(10000);

    const guiSystemProject: RosProject = {
      formatVersion: 4,
      system: { name: 'vision_pipeline_system', comments: {} },
      subSystems: [
        { ref: 'navigation_subsystem', state: 'collapsed' },
      ],
      nodes: [
        {
          id: 'n_filter_node',
          label: 'filter_node',
          from: 'vision_pkg.filter_node',
          pkg: 'vision_pkg',
          artifact: 'filter_node',
          backing: 'local',
          ifaces: [
            {
              id: 'i_filter_node_image_out',
              name: 'image_out',
              label: 'filtered_image_pub',
              kind: 'pub',
              type: 'sensor_msgs/msg/Image',
              exposed: true,
            },
            {
              id: 'i_filter_node_image_in',
              name: 'image_in',
              label: 'raw_image_sub',
              kind: 'sub',
              type: 'sensor_msgs/msg/Image',
              exposed: true,
            },
          ],
          params: [
            {
              id: 'p_filter_node_threshold',
              name: 'threshold',
              label: 'threshold',
              ptype: 'Double',
              sysValue: '0.75',
              exposed: true,
            },
          ],
        },
        {
          id: 'n_consumer_node',
          label: 'consumer_node',
          from: 'vision_pkg.consumer_node',
          pkg: 'vision_pkg',
          artifact: 'consumer_node',
          backing: 'local',
          ifaces: [
            {
              id: 'i_consumer_node_image_in',
              name: 'image_in',
              label: 'consumer_image_sub',
              kind: 'sub',
              type: 'sensor_msgs/msg/Image',
              exposed: true,
            },
          ],
          params: [],
        },
      ],
      connections: [
        {
          id: 'c_filtered_to_consumer',
          from: { n: 'n_filter_node', i: 'i_filter_node_image_out' },
          to: { n: 'n_consumer_node', i: 'i_consumer_node_image_in' },
        },
      ],
      packages: {},
      types: {},
      view: { tx: 40, ty: 40, k: 1, level: 3 },
    };

    const emittedRosSystem = RosModelEmitter.emitRosSystem(guiSystemProject);

    // Verify correct Xtext syntax productions in emitted string
    assert.ok(emittedRosSystem.includes('vision_pipeline_system:'));
    assert.ok(emittedRosSystem.includes('navigation_subsystem'));
    assert.ok(emittedRosSystem.includes('filter_node:'));
    assert.ok(emittedRosSystem.includes('from: "vision_pkg.filter_node"'));
    assert.ok(emittedRosSystem.includes('- filtered_image_pub: pub-> "filter_node::image_out"'));
    assert.ok(emittedRosSystem.includes('- raw_image_sub: sub-> "filter_node::image_in"'));
    assert.ok(emittedRosSystem.includes('- ["filtered_image_pub", "consumer_image_sub"]'));

    // Validate via LSP protocol
    const diags = await lspValidator.validate(
      'file:///tmp/vision_pipeline.rossystem',
      'rossystem',
      emittedRosSystem
    );

    const syntaxErrors = getSyntaxErrors(diags);
    assert.strictEqual(
      syntaxErrors.length,
      0,
      `Expected 0 syntax errors from LSP, got: ${JSON.stringify(syntaxErrors, null, 2)}`
    );
  });

  test('Validate demo test_system.rossystem against Xtext parser via LSP', async function () {
    this.timeout(10000);

    const testSystemContent = `test_system:
  nodes:
    node1:
      from: "test_system.image_filter"
      interfaces:
        - "filtered_image_pub": pub-> "image_filter::image_out"
        - "description_pub": pub-> "image_filter::description_out"
        - "image_sub": sub-> "image_filter::image_in"
        - "laser_sub": sub-> "image_filter::laser_in"
      parameters:
        - "ImageName": "image_filter::image_name"
          value: "image_raw"
    node2:
      from: "test_system.consumer"
      interfaces:
        - "filtered_image_sub": sub-> "consumer::image_in"
        - "description_sub": sub-> "consumer::description_in"
        - "inferenced_image_pub": pub-> "consumer::image_out"
  connections:
    - ["filtered_image_pub", "filtered_image_sub"]
    - ["description_pub", "description_sub"]
`;

    // Round-trip parse and emit
    const parsed = RosModelParser.parseRosSystem(testSystemContent, 'test_system.rossystem');
    const emitted = RosModelEmitter.emitRosSystem(parsed);

    // Validate via LSP
    const diags = await lspValidator.validate(
      'file:///tmp/demo_test_system.rossystem',
      'rossystem',
      emitted
    );

    const syntaxErrors = getSyntaxErrors(diags);
    assert.strictEqual(
      syntaxErrors.length,
      0,
      `Expected 0 syntax errors from LSP, got: ${JSON.stringify(syntaxErrors, null, 2)}`
    );
  });

  test('Validate .ros2 model with non-conventional interface and parameter characters via LSP', async function () {
    this.timeout(10000);

    const nonConventionalProject: RosProject = {
      formatVersion: 4,
      system: { name: 'sensor_pkg_system', comments: {} },
      subSystems: [],
      nodes: [
        {
          id: 'n_sensor_node',
          label: 'sensor_node',
          pkg: 'sensor_pkg',
          artifact: 'sensor_node',
          from: 'sensor_pkg.sensor_node',
          backing: 'local',
          ifaces: [
            {
              id: 'i_sensor_node_raw',
              name: 'scan',
              label: 'scan',
              kind: 'pub',
              type: 'sensor_msgs/msg/LaserScan',
              exposed: true,
            },
            {
              id: 'i_sensor_node_slash',
              name: '/robot1/scan',
              label: '/robot1/scan',
              kind: 'pub',
              type: 'sensor_msgs/msg/LaserScan',
              exposed: true,
            },
            {
              id: 'i_sensor_node_dot',
              name: 'sensor.data.stream',
              label: 'sensor.data.stream',
              kind: 'sub',
              type: 'std_msgs/msg/String',
              exposed: true,
            },
          ],
          params: [
            {
              id: 'p_sensor_node_rate',
              name: 'rate',
              label: 'rate',
              ptype: 'Integer',
              value: '50',
              exposed: true,
            },
            {
              id: 'p_sensor_node_override',
              name: 'qos_overrides./parameter_events.publisher.depth',
              label: 'qos_overrides./parameter_events.publisher.depth',
              ptype: 'Integer',
              value: '1000',
              exposed: true,
            },
          ],
        },
      ],
      connections: [],
      packages: {},
      types: {},
    };

    const emittedRos2 = RosModelEmitter.emitRos2(nonConventionalProject, 'sensor_pkg');

    // Assert that special characters are wrapped in quotes and conventional ones are not
    assert.ok(emittedRos2.includes('scan:'));
    assert.ok(emittedRos2.includes('"/robot1/scan":'));
    assert.ok(emittedRos2.includes('"sensor.data.stream":'));
    assert.ok(emittedRos2.includes('rate:'));
    assert.ok(emittedRos2.includes('"qos_overrides./parameter_events.publisher.depth":'));

    const diags = await lspValidator.validate(
      'file:///tmp/sensor_pkg.ros2',
      'ros2',
      emittedRos2
    );

    const syntaxErrors = getSyntaxErrors(diags);
    assert.strictEqual(
      syntaxErrors.length,
      0,
      `Expected 0 syntax errors from LSP for non-conventional characters, got: ${JSON.stringify(syntaxErrors, null, 2)}`
    );
  });

  test('Validate .ros model (messages, services, actions) against Xtext RosValidator via LSP', async function () {
    this.timeout(10000);

    const rosText = `my_msgs:
  msgs:
    CustomPoint
      message
        float64 x
        float64 y
        float64 z
        uint8 STATUS_ACTIVE=1
    CustomHeader
      message
        int32 seq
        string frame_id
  srvs:
    CalculateTransform
      request
        string source_frame
        string target_frame
      response
        float64 distance
        bool success
  actions:
    ExecuteTrajectory
      goal
        string trajectory_id
        float64 target_velocity
      result
        bool reached
      feedback
        float64 current_progress
`;

    const project = RosModelParser.parseRos(rosText, 'my_msgs.ros');
    assert.strictEqual(project.isRos, true);
    assert.strictEqual(project.nodes.length, 4);

    const emitted = RosModelEmitter.emitRos(project);

    const diags = await lspValidator.validate(
      'file:///tmp/my_msgs.ros',
      'ros',
      emitted
    );

    const syntaxErrors = getSyntaxErrors(diags);
    assert.strictEqual(
      syntaxErrors.length,
      0,
      `Expected 0 syntax errors from LSP for .ros model, got: ${JSON.stringify(syntaxErrors, null, 2)}`
    );
  });
});
