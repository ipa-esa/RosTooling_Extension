import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';
import { workspace, Uri } from 'vscode';
import { cleanRedundantBuildFiles, ensureLaunchInstallInCMake, ensureLaunchDepsInPackageXml, cleanOppositeLanguageFiles, toCamelCase, toSnakeCase } from '../extension';

suite('Redundant Build Files Cleanup Test Suite', () => {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  test('Prune Python setuptools files and resource folder when switching to CMake/Hybrid package', async () => {
    const testGenUri = Uri.file(path.join(os.tmpdir(), `test-cleanup-cmake-${Date.now()}`));
    const pkgName = 'test_hybrid_pkg';
    const pkgUri = Uri.joinPath(testGenUri, pkgName);

    // Create redundant Python setuptools files + resource folder
    await workspace.fs.createDirectory(pkgUri);
    await workspace.fs.writeFile(Uri.joinPath(pkgUri, 'setup.py'), encoder.encode('# setup.py'));
    await workspace.fs.writeFile(Uri.joinPath(pkgUri, 'setup.cfg'), encoder.encode('[develop]\n'));
    await workspace.fs.writeFile(Uri.joinPath(pkgUri, 'pyproject.toml'), encoder.encode('[build-system]\n'));
    await workspace.fs.createDirectory(Uri.joinPath(pkgUri, 'resource'));
    await workspace.fs.writeFile(Uri.joinPath(pkgUri, 'resource', pkgName), encoder.encode(''));
    await workspace.fs.writeFile(Uri.joinPath(pkgUri, 'resource', `${pkgName}.puml`), encoder.encode('@startuml\n@enduml'));

    // Execute cleanup for CMake package
    await cleanRedundantBuildFiles(testGenUri, pkgName, true);

    // Assert redundant files are deleted
    const fileExists = async (uri: Uri) => {
      try {
        await workspace.fs.stat(uri);
        return true;
      } catch {
        return false;
      }
    };

    assert.strictEqual(await fileExists(Uri.joinPath(pkgUri, 'setup.py')), false, 'setup.py must be deleted');
    assert.strictEqual(await fileExists(Uri.joinPath(pkgUri, 'setup.cfg')), false, 'setup.cfg must be deleted');
    assert.strictEqual(await fileExists(Uri.joinPath(pkgUri, 'pyproject.toml')), false, 'pyproject.toml must be deleted');
    assert.strictEqual(await fileExists(Uri.joinPath(pkgUri, 'resource', pkgName)), false, 'resource marker must be deleted');
    assert.strictEqual(await fileExists(Uri.joinPath(pkgUri, 'resource', `${pkgName}.puml`)), true, 'resource puml must NOT be deleted');
    assert.strictEqual(await fileExists(Uri.joinPath(pkgUri, 'resource')), true, 'resource folder must NOT be deleted while it contains puml');

    // Cleanup test folder
    await workspace.fs.delete(testGenUri, { recursive: true, useTrash: false });
  });

  test('Prune empty resource folder when only marker was present', async () => {
    const testGenUri = Uri.file(path.join(os.tmpdir(), `test-cleanup-empty-res-${Date.now()}`));
    const pkgName = 'test_empty_res_pkg';
    const pkgUri = Uri.joinPath(testGenUri, pkgName);

    await workspace.fs.createDirectory(pkgUri);
    await workspace.fs.createDirectory(Uri.joinPath(pkgUri, 'resource'));
    await workspace.fs.writeFile(Uri.joinPath(pkgUri, 'resource', pkgName), encoder.encode(''));

    await cleanRedundantBuildFiles(testGenUri, pkgName, true);

    const fileExists = async (uri: Uri) => {
      try {
        await workspace.fs.stat(uri);
        return true;
      } catch {
        return false;
      }
    };

    assert.strictEqual(await fileExists(Uri.joinPath(pkgUri, 'resource', pkgName)), false, 'resource marker must be deleted');
    assert.strictEqual(await fileExists(Uri.joinPath(pkgUri, 'resource')), false, 'empty resource folder must be deleted');

    await workspace.fs.delete(testGenUri, { recursive: true, useTrash: false });
  });

  test('Prune CMakeLists.txt and pyproject.toml when switching to pure Python package', async () => {
    const testGenUri = Uri.file(path.join(os.tmpdir(), `test-cleanup-python-${Date.now()}`));
    const pkgName = 'test_python_pkg';
    const pkgUri = Uri.joinPath(testGenUri, pkgName);

    // Create redundant CMake and TOML files alongside valid Python setup
    await workspace.fs.createDirectory(pkgUri);
    await workspace.fs.writeFile(Uri.joinPath(pkgUri, 'CMakeLists.txt'), encoder.encode('cmake_minimum_required(VERSION 3.8)'));
    await workspace.fs.writeFile(Uri.joinPath(pkgUri, 'pyproject.toml'), encoder.encode('[build-system]\n'));
    await workspace.fs.writeFile(Uri.joinPath(pkgUri, 'setup.py'), encoder.encode('# valid setup.py'));

    // Execute cleanup for pure Python package
    await cleanRedundantBuildFiles(testGenUri, pkgName, false);

    const fileExists = async (uri: Uri) => {
      try {
        await workspace.fs.stat(uri);
        return true;
      } catch {
        return false;
      }
    };

    assert.strictEqual(await fileExists(Uri.joinPath(pkgUri, 'CMakeLists.txt')), false, 'CMakeLists.txt must be deleted');
    assert.strictEqual(await fileExists(Uri.joinPath(pkgUri, 'pyproject.toml')), false, 'pyproject.toml must be deleted');
    assert.strictEqual(await fileExists(Uri.joinPath(pkgUri, 'setup.py')), true, 'setup.py must be preserved');

    // Cleanup test folder
    await workspace.fs.delete(testGenUri, { recursive: true, useTrash: false });
  });

  test('Inject launch install directives into existing CMakeLists.txt lacking them', async () => {
    const testGenUri = Uri.file(path.join(os.tmpdir(), `test-launch-cmake-${Date.now()}`));
    const pkgName = 'test_monolithic_pkg';
    const pkgUri = Uri.joinPath(testGenUri, pkgName);

    // Create CMakeLists.txt that builds cpp and py nodes but lacks launch install
    await workspace.fs.createDirectory(pkgUri);
    const initialCMake = `cmake_minimum_required(VERSION 3.8)
project(test_monolithic_pkg)

find_package(ament_cmake REQUIRED)
find_package(ament_cmake_python REQUIRED)
find_package(rclcpp REQUIRED)

add_executable(my_node src/Node.cpp)
ament_target_dependencies(my_node rclcpp)

ament_python_install_package(\${PROJECT_NAME})

install(TARGETS my_node
  DESTINATION lib/\${PROJECT_NAME}
)

ament_package()
`;
    await workspace.fs.writeFile(Uri.joinPath(pkgUri, 'CMakeLists.txt'), encoder.encode(initialCMake));

    // Execute launch install injection
    await ensureLaunchInstallInCMake(testGenUri, pkgName);

    const updatedBytes = await workspace.fs.readFile(Uri.joinPath(pkgUri, 'CMakeLists.txt'));
    const updatedContent = decoder.decode(updatedBytes);

    assert.ok(updatedContent.includes('install(DIRECTORY launch'), 'Must include launch install directive');
    assert.ok(updatedContent.includes('DESTINATION share/${PROJECT_NAME}'), 'Must install to share/${PROJECT_NAME}');
    assert.ok(updatedContent.includes('ament_package()'), 'Must retain ament_package()');
    assert.ok(updatedContent.includes('add_executable(my_node src/Node.cpp)'), 'Must preserve node build targets');

    // Idempotency: running again should not duplicate
    await ensureLaunchInstallInCMake(testGenUri, pkgName);
    const secondBytes = await workspace.fs.readFile(Uri.joinPath(pkgUri, 'CMakeLists.txt'));
    const secondContent = decoder.decode(secondBytes);
    const occurrences = (secondContent.match(/install\(DIRECTORY launch/g) || []).length;
    assert.strictEqual(occurrences, 1, 'Launch install directive must only be injected once');

    // Cleanup test folder
    await workspace.fs.delete(testGenUri, { recursive: true, useTrash: false });
  });

  test('Inject launch dependencies into existing package.xml lacking them', async () => {
    const testGenUri = Uri.file(path.join(os.tmpdir(), `test-launch-pkgxml-${Date.now()}`));
    const pkgName = 'test_monolithic_pkg';
    const pkgUri = Uri.joinPath(testGenUri, pkgName);

    await workspace.fs.createDirectory(pkgUri);
    const initialPkgXml = `<?xml version="1.0"?>
<package format="3">
  <name>test_monolithic_pkg</name>
  <version>0.0.1</version>
  <description>Package with custom nodes</description>
  <maintainer email="user@todo.todo">ROS Developer</maintainer>
  <license>Apache-2.0</license>
  <depend>rclcpp</depend>
</package>
`;
    await workspace.fs.writeFile(Uri.joinPath(pkgUri, 'package.xml'), encoder.encode(initialPkgXml));

    await ensureLaunchDepsInPackageXml(testGenUri, pkgName);

    const updatedBytes = await workspace.fs.readFile(Uri.joinPath(pkgUri, 'package.xml'));
    const updatedContent = decoder.decode(updatedBytes);

    assert.ok(updatedContent.includes('<exec_depend>launch</exec_depend>'), 'Must include launch exec_depend');
    assert.ok(updatedContent.includes('<exec_depend>launch_ros</exec_depend>'), 'Must include launch_ros exec_depend');
    assert.ok(updatedContent.includes('<depend>rclcpp</depend>'), 'Must preserve existing depend');

    // Idempotency
    await ensureLaunchDepsInPackageXml(testGenUri, pkgName);
    const secondBytes = await workspace.fs.readFile(Uri.joinPath(pkgUri, 'package.xml'));
    const secondContent = decoder.decode(secondBytes);
    const occurrences = (secondContent.match(/<exec_depend>launch<\/exec_depend>/g) || []).length;
    assert.strictEqual(occurrences, 1, 'Launch exec_depend must only be injected once');

    await workspace.fs.delete(testGenUri, { recursive: true, useTrash: false });
  });

  test('Casing conversion helpers (toCamelCase and toSnakeCase)', () => {
    assert.strictEqual(toCamelCase('minimal_server_node'), 'MinimalServerNode');
    assert.strictEqual(toCamelCase('minimal_server'), 'MinimalServer');
    assert.strictEqual(toCamelCase('add-two-ints'), 'AddTwoInts');
    assert.strictEqual(toCamelCase(''), '');

    assert.strictEqual(toSnakeCase('MinimalServerNode'), 'minimal_server_node');
    assert.strictEqual(toSnakeCase('minimal_server'), 'minimal_server');
    assert.strictEqual(toSnakeCase('MinimalServer'), 'minimal_server');
    assert.strictEqual(toSnakeCase(''), '');
  });

  test('Prune obsolete Python files when a node is switched to C++', async () => {
    const testGenUri = Uri.file(path.join(os.tmpdir(), `test-node-switch-cpp-${Date.now()}`));
    const pkgName = 'examples_minimal_service';
    const pkgUri = Uri.joinPath(testGenUri, pkgName);
    const pyPkgDir = Uri.joinPath(pkgUri, pkgName);

    await workspace.fs.createDirectory(pyPkgDir);
    await workspace.fs.writeFile(Uri.joinPath(pyPkgDir, '__init__.py'), encoder.encode(''));
    await workspace.fs.writeFile(Uri.joinPath(pyPkgDir, 'minimal_server_wrapper.py'), encoder.encode('# wrapper'));
    await workspace.fs.writeFile(Uri.joinPath(pyPkgDir, 'minimal_server_runner.py'), encoder.encode('# runner'));
    await workspace.fs.writeFile(Uri.joinPath(pyPkgDir, 'minimal_server_logic.py'), encoder.encode('# logic'));

    const fileExists = async (uri: Uri) => {
      try {
        await workspace.fs.stat(uri);
        return true;
      } catch {
        return false;
      }
    };

    assert.strictEqual(await fileExists(Uri.joinPath(pyPkgDir, 'minimal_server_wrapper.py')), true);

    // Switch minimal_server to C++
    await cleanOppositeLanguageFiles(
      testGenUri,
      pkgName,
      { artifactName: 'minimal_server_node', nodeName: 'minimal_server' },
      'cpp'
    );

    assert.strictEqual(await fileExists(Uri.joinPath(pyPkgDir, 'minimal_server_wrapper.py')), false, 'wrapper.py must be deleted');
    assert.strictEqual(await fileExists(Uri.joinPath(pyPkgDir, 'minimal_server_runner.py')), false, 'runner.py must be deleted');
    assert.strictEqual(await fileExists(Uri.joinPath(pyPkgDir, 'minimal_server_logic.py')), false, 'logic.py must be deleted');
    assert.strictEqual(await fileExists(pyPkgDir), false, 'Empty Python module folder must be cleaned up');

    await workspace.fs.delete(testGenUri, { recursive: true, useTrash: false });
  });

  test('Prune obsolete C++ files when a node is switched to Python', async () => {
    const testGenUri = Uri.file(path.join(os.tmpdir(), `test-node-switch-py-${Date.now()}`));
    const pkgName = 'examples_minimal_service';
    const pkgUri = Uri.joinPath(testGenUri, pkgName);
    const incDir = Uri.joinPath(pkgUri, 'include', pkgName);
    const srcDir = Uri.joinPath(pkgUri, 'src');

    await workspace.fs.createDirectory(incDir);
    await workspace.fs.createDirectory(srcDir);
    await workspace.fs.writeFile(Uri.joinPath(incDir, 'MinimalServerNodeWrapper.hpp'), encoder.encode('// header'));
    await workspace.fs.writeFile(Uri.joinPath(incDir, 'MinimalServerNodeAlgorithm.hpp'), encoder.encode('// algorithm'));
    await workspace.fs.writeFile(Uri.joinPath(srcDir, 'MinimalServerNodeWrapper.cpp'), encoder.encode('// cpp'));
    await workspace.fs.writeFile(Uri.joinPath(srcDir, 'MinimalServerNodeRunner.cpp'), encoder.encode('// cpp'));

    const fileExists = async (uri: Uri) => {
      try {
        await workspace.fs.stat(uri);
        return true;
      } catch {
        return false;
      }
    };

    assert.strictEqual(await fileExists(Uri.joinPath(srcDir, 'MinimalServerNodeRunner.cpp')), true);

    // Switch minimal_server to Python
    await cleanOppositeLanguageFiles(
      testGenUri,
      pkgName,
      { artifactName: 'minimal_server_node', nodeName: 'minimal_server' },
      'python'
    );

    assert.strictEqual(await fileExists(Uri.joinPath(incDir, 'MinimalServerNodeWrapper.hpp')), false, 'Wrapper.hpp must be deleted');
    assert.strictEqual(await fileExists(Uri.joinPath(incDir, 'MinimalServerNodeAlgorithm.hpp')), false, 'Algorithm.hpp must be deleted');
    assert.strictEqual(await fileExists(Uri.joinPath(srcDir, 'MinimalServerNodeWrapper.cpp')), false, 'Wrapper.cpp must be deleted');
    assert.strictEqual(await fileExists(Uri.joinPath(srcDir, 'MinimalServerNodeRunner.cpp')), false, 'Runner.cpp must be deleted');
    assert.strictEqual(await fileExists(srcDir), false, 'Empty src folder must be cleaned up');
    assert.strictEqual(await fileExists(Uri.joinPath(pkgUri, 'include')), false, 'Empty include folder must be cleaned up');

    await workspace.fs.delete(testGenUri, { recursive: true, useTrash: false });
  });

  test('Preserve other nodes files when switching a node language in a hybrid package', async () => {
    const testGenUri = Uri.file(path.join(os.tmpdir(), `test-hybrid-preserve-${Date.now()}`));
    const pkgName = 'examples_minimal_service';
    const pkgUri = Uri.joinPath(testGenUri, pkgName);
    const pyPkgDir = Uri.joinPath(pkgUri, pkgName);

    await workspace.fs.createDirectory(pyPkgDir);
    await workspace.fs.writeFile(Uri.joinPath(pyPkgDir, '__init__.py'), encoder.encode(''));
    // Node A (minimal_server)
    await workspace.fs.writeFile(Uri.joinPath(pyPkgDir, 'minimal_server_wrapper.py'), encoder.encode('# server'));
    // Node B (minimal_client)
    await workspace.fs.writeFile(Uri.joinPath(pyPkgDir, 'minimal_client_wrapper.py'), encoder.encode('# client'));

    const fileExists = async (uri: Uri) => {
      try {
        await workspace.fs.stat(uri);
        return true;
      } catch {
        return false;
      }
    };

    // Only switch Node A (minimal_server) to C++
    await cleanOppositeLanguageFiles(
      testGenUri,
      pkgName,
      { artifactName: 'minimal_server_node', nodeName: 'minimal_server' },
      'cpp'
    );

    assert.strictEqual(await fileExists(Uri.joinPath(pyPkgDir, 'minimal_server_wrapper.py')), false, 'minimal_server must be pruned');
    assert.strictEqual(await fileExists(Uri.joinPath(pyPkgDir, 'minimal_client_wrapper.py')), true, 'minimal_client must be preserved');
    assert.strictEqual(await fileExists(pyPkgDir), true, 'Python package folder must be preserved while client remains');

    await workspace.fs.delete(testGenUri, { recursive: true, useTrash: false });
  });
});

