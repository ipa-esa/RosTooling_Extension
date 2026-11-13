import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { LspValidator, LspDiagnostic } from './LspValidator';

suite('LSP Protocol Model Validation Test Suite', () => {
  let lspValidator: LspValidator;
  const extensionRoot = path.resolve(__dirname, '..', '..');
  const defaultUserPath = path.join(os.homedir(), '.rostooling', 'catalogue_repos');
  const ideStoragePath = path.join(
    os.homedir(),
    '.config/Antigravity IDE/User/globalStorage/rostooling.rostooling-languages/catalogue_repos'
  );
  const cataloguePath =
    process.env.ROSTOOLING_CATALOGUE_PATH ||
    (fs.existsSync(defaultUserPath) && fs.readdirSync(defaultUserPath).length > 0
      ? defaultUserPath
      : fs.existsSync(ideStoragePath)
        ? ideStoragePath
        : defaultUserPath);

  suiteSetup(async function () {
    this.timeout(15000);
    if (!LspValidator.hasServerJar(extensionRoot)) {
      console.warn('Language Server JAR not found; skipping LSP validation tests.');
      this.skip();
      return;
    }
    lspValidator = new LspValidator(extensionRoot, cataloguePath);
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

    const emitted = testSystemContent;

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

  test('Validate .rossystem model with processes (component containers) via LSP', async function () {
    this.timeout(10000);

    const systemWithProcesses = `perception_system:
  processes:
    vision_proc:
      nodes: [ node1 ]
      threads: 4
  nodes:
    node1:
      from: "test_system.image_filter"
      interfaces:
        - "filtered_image_pub": pub-> "image_filter::image_out"
    node2:
      from: "test_system.consumer"
      interfaces:
        - "filtered_image_sub": sub-> "consumer::image_in"
  connections:
    - ["filtered_image_pub", "filtered_image_sub"]
`;

    const emitted = systemWithProcesses;

    const diags = await lspValidator.validate(
      'file:///tmp/perception_system.rossystem',
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

  test('Validate duplicate process assignment diagnostic in .rossystem via LSP', async function () {
    this.timeout(10000);

    const duplicateProcessSystem = `dup_system:
  processes:
    proc1:
      nodes: [ node1 ]
    proc2:
      nodes: [ node1 ]
  nodes:
    node1:
      from: "test_system.image_filter"
`;

    const diags = await lspValidator.validate(
      'file:///tmp/dup_system.rossystem',
      'rossystem',
      duplicateProcessSystem
    );

    const dupDiag = diags.find((d) =>
      d.message.includes('assigned to multiple processes')
    );
    assert.ok(
      dupDiag,
      `Expected duplicate process assignment error diagnostic, got: ${JSON.stringify(diags, null, 2)}`
    );
  });

  test('Validate .ros model (messages, services, actions with string/numeric constants) against Xtext RosValidator via LSP', async function () {
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
        string DEFAULT_FRAME="base_link"
        string GREETING='hello world'
        string CODE=active
  srvs:
    CalculateTransform
      request
        string source_frame
        string target_frame
        string MODE="fast"
      response
        float64 distance
        bool success
        string STATUS="done"
  actions:
    ExecuteTrajectory
      goal
        string trajectory_id
        float64 target_velocity
        string ACTION_TYPE="start"
      result
        bool reached
        string RESULT_CODE="completed"
      feedback
        float64 current_progress
        string STAGE_MSG="executing"
`;

    const emitted = rosText;

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

  test('Validate demo test_system.rossystem referencing catalogue subsystem ur_robot resolves with zero errors', async function () {
    this.timeout(10000);

    const testSystemPath = path.resolve(
      extensionRoot,
      '..',
      'demo',
      'test_ws',
      'src',
      'test_system',
      'test_system.rossystem'
    );
    assert.ok(fs.existsSync(testSystemPath), `File not found: ${testSystemPath}`);
    const content = fs.readFileSync(testSystemPath, 'utf-8');

    const diags = await lspValidator.validate(
      'file://' + testSystemPath,
      'rossystem',
      content
    );

    const errors = diags.filter((d) => d.severity === 1);
    const unresolvedSubsystemErrors = errors.filter((d) =>
      d.message.includes("Couldn't resolve reference to System 'ur_robot'")
    );

    assert.strictEqual(
      unresolvedSubsystemErrors.length,
      0,
      `Expected ur_robot subsystem reference to resolve cleanly from catalogue library, but got: ${JSON.stringify(errors, null, 2)}`
    );
  });

  test('Validate workspace models index on startup: test_system.rossystem resolves test_system.image_filter without opening test_node.ros2', async function () {
    this.timeout(15000);

    const testWsDir = path.resolve(extensionRoot, '..', 'demo', 'test_ws');
    const wsValidator = new LspValidator(extensionRoot, cataloguePath);
    await wsValidator.init('file://' + testWsDir, [
      { uri: 'file://' + testWsDir, name: 'test_ws' },
    ]);

    const testSystemPath = path.resolve(
      testWsDir,
      'src',
      'test_system',
      'test_system.rossystem'
    );
    assert.ok(fs.existsSync(testSystemPath), `File not found: ${testSystemPath}`);
    const content = fs.readFileSync(testSystemPath, 'utf-8');

    // Validate test_system.rossystem WITHOUT opening test_node.ros2
    const diags = await wsValidator.validate(
      'file://' + testSystemPath,
      'rossystem',
      content
    );

    const errors = diags.filter((d) => d.severity === 1);
    const unresolvedNodeErrors = errors.filter((d) =>
      d.message.includes("Couldn't resolve reference to Node 'test_system.image_filter'")
    );

    wsValidator.stop();

    assert.strictEqual(
      unresolvedNodeErrors.length,
      0,
      `Expected test_system.image_filter to resolve from disk index without opening test_node.ros2, but got: ${JSON.stringify(errors, null, 2)}`
    );
  });

  test('End-to-End: Generate ROS 2 launch file with ComposableNodeContainer from rossystem with processes', async function () {
    this.timeout(20000);

    const testWsDir = path.resolve(extensionRoot, '..', 'demo', 'test_ws');
    const wsValidator = new LspValidator(extensionRoot, cataloguePath);
    await wsValidator.init('file://' + testWsDir, [
      { uri: 'file://' + testWsDir, name: 'test_ws' },
    ]);

    const testSystemPath = path.resolve(
      testWsDir,
      'src',
      'test_system',
      'test_system.rossystem'
    );
    const systemUri = 'file://' + testSystemPath;

    const result = await wsValidator.executeCommand<{
      success?: boolean;
      files?: Record<string, string>;
      error?: string;
    }>('rossystem.generateCode', [systemUri, []]);

    wsValidator.stop();

    assert.ok(result, 'Generation result must not be null/undefined');
    assert.strictEqual(result.error, undefined, `Generation returned error: ${result.error}`);
    const files = result.files ?? {};
    assert.ok(result.files, 'Result must contain generated files map');

    // Find the launch file
    const launchFileKey = Object.keys(files).find((k) => k.endsWith('test_system.launch.py'));
    assert.ok(launchFileKey, `Launch file not found in generated files: ${Object.keys(files).join(', ')}`);

    const launchContent = files[launchFileKey];

    // Assert ComposableNodeContainer is imported and configured
    assert.ok(
      launchContent.includes('from launch_ros.actions import ComposableNodeContainer'),
      'Must import ComposableNodeContainer'
    );
    assert.ok(
      launchContent.includes('from launch_ros.descriptions import ComposableNode'),
      'Must import ComposableNode'
    );
    assert.ok(
      launchContent.includes('package="rclcpp_components"'),
      'Must use rclcpp_components package for container'
    );
    assert.ok(
      launchContent.includes('executable="component_container_mt"'),
      'Must use component_container_mt because threads: 2 > 1'
    );
    assert.ok(
      launchContent.includes('name="process1"'),
      'Container name must be process1'
    );
    assert.ok(
      launchContent.includes('package="test_system"'),
      'Composable node package must be test_system'
    );
    assert.ok(
      launchContent.includes('plugin="test_system::ImageFilterNode"'),
      'Must register ImageFilterNode plugin'
    );
    assert.ok(
      launchContent.includes('plugin="test_system::ConsumerNode"'),
      'Must register ConsumerNode plugin'
    );
    assert.ok(
      launchContent.includes('ld.add_action(container_process1)'),
      'Must add container_process1 to LaunchDescription'
    );

    // Also assert package.xml has rclcpp_components exec_depend
    const pkgXmlKey = Object.keys(files).find((k) => k.endsWith('package.xml'));
    assert.ok(pkgXmlKey, 'package.xml not found');
    const pkgXmlContent = files[pkgXmlKey];
    assert.ok(
      pkgXmlContent.includes('<exec_depend>rclcpp_components</exec_depend>'),
      'package.xml must declare exec_depend on rclcpp_components'
    );
  });

  test('Package-scoped file persistence: Algorithm stub is recreated if file is in another package or outside dir', async function () {
    this.timeout(20000);

    const testWsDir = path.resolve(extensionRoot, '..', 'demo', 'test_ws');
    const wsValidator = new LspValidator(extensionRoot, cataloguePath);
    await wsValidator.init('file://' + testWsDir, [
      { uri: 'file://' + testWsDir, name: 'test_ws' },
    ]);

    const minimalActionPath = path.resolve(
      testWsDir,
      'src',
      'minimal_action',
      'minimal_actions.ros2'
    );
    const modelUri = 'file://' + minimalActionPath;

    // Test 1: File is in an outside directory / other package.
    // The generator should NOT think it already exists for examples_minimal_actions,
    // and MUST recreate ActionClientAlgorithm.hpp.
    const outsideFiles = [
      'outside_dir/ActionClientAlgorithm.hpp',
      'other_pkg/include/other_pkg/ActionClientAlgorithm.hpp',
    ];
    const resultRecreate = await wsValidator.executeCommand<{
      success?: boolean;
      files?: Record<string, string>;
      error?: string;
    }>('ros2.generateWrappersServer', [
      modelUri,
      ['action_client'],
      'cpp',
      'humble',
      outsideFiles,
    ]);

    assert.ok(resultRecreate, 'Result must not be null');
    assert.strictEqual(resultRecreate.error, undefined, `Unexpected error: ${resultRecreate.error}`);
    const filesRecreated = resultRecreate.files ?? {};
    const algoKey = Object.keys(filesRecreated).find((k) =>
      k.endsWith('ActionClientAlgorithm.hpp')
    );
    assert.ok(
      algoKey,
      'ActionClientAlgorithm.hpp must be generated when outside directory files are passed in existingFiles'
    );

    // Test 2: File is inside examples_minimal_actions.
    // The generator MUST preserve it and NOT recreate it.
    const inPackageFiles = [
      'examples_minimal_actions/include/examples_minimal_actions/ActionClientAlgorithm.hpp',
    ];
    const resultPreserve = await wsValidator.executeCommand<{
      success?: boolean;
      files?: Record<string, string>;
      error?: string;
    }>('ros2.generateWrappersServer', [
      modelUri,
      ['action_client'],
      'cpp',
      'humble',
      inPackageFiles,
    ]);

    wsValidator.stop();

    assert.ok(resultPreserve, 'Result must not be null');
    assert.strictEqual(resultPreserve.error, undefined, `Unexpected error: ${resultPreserve.error}`);
    const filesPreserved = resultPreserve.files ?? {};
    const algoPreservedKey = Object.keys(filesPreserved).find((k) =>
      k.endsWith('ActionClientAlgorithm.hpp')
    );
    assert.strictEqual(
      algoPreservedKey,
      undefined,
      'ActionClientAlgorithm.hpp must NOT be generated when it already exists in the package directory'
    );
  });
});

