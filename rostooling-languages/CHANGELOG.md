# Change Log

All notable changes to the "rostooling-languages" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.2.0] - 2026-10-05

### Added
- **Composable Component & Process Support**:
  - Full parser and emitter support for `.rossystem` `processes:` section with node lists and thread counts.
  - Bundled updated Language Server fat JAR containing composable component launch file generation (`ComposableNodeContainer` with `component_container_mt` / `component_container`) and validation rules.
  - Added LSP test cases verifying `.rossystem` process definitions and diagnostics against duplicate node process assignment.
- **Single-Language Node Selection & Interactive Wrapper Generation**:
  - Interactive language selection prompt when generating node wrappers from `.ros2` models:
    - Single-node packages: Select directly between `C++` and `Python`.
    - Multi-node packages: Select between `All C++`, `All Python`, or `Configure per node...`.
  - Added per-node configuration prompt allowing users to assign implementation languages individually across nodes in a monolithic package.
  - Multi-step hybrid generator coordination: generates C++ nodes and Python nodes seamlessly within a unified run, combining build scripts into hybrid `ament_cmake_python` configurations.
- **Node-Level Opposite-Language File Pruning (`cleanOppositeLanguageFiles`)**:
  - Added automated pruning of opposite-language source, runner, and logic files on disk when a node's implementation language is switched.
  - Switching to C++ prunes obsolete Python files (`<node>_wrapper.py`, `<node>_runner.py`, `<node>_logic.py`) and deletes the package folder if no other Python nodes remain.
  - Switching to Python prunes obsolete C++ files (`<Node>Wrapper.hpp`, `<Node>Node.hpp`, `<Node>Algorithm.hpp`, `<Node>Wrapper.cpp`, `<Node>Node.cpp`, `<Node>Runner.cpp`) and deletes empty `src/` and `include/` directories.
  - Strictly preserves files belonging to other companion nodes in hybrid packages.
- **Automated Redundant Build & Setup File Cleanup (`cleanRedundantBuildFiles`)**:
  - Automatically prunes conflicting build and setup files (`setup.py`, `setup.cfg`, `pyproject.toml`, and setuptools marker `resource/<pkg>`) when regenerating as CMake / Hybrid packages, eliminating Pyright PEP 517 src-layout module resolution errors.
  - Automatically prunes obsolete `CMakeLists.txt` and `pyproject.toml` when regenerating pure Python packages.
  - Strictly preserves PlantUML architecture diagrams (`resource/<pkg>.puml`) from deletion across all build cleanup routines.
- **Unconditional `OPTIONAL` Launch & Configuration Installation (`ensureLaunchInstallInCMake`)**:
  - Updated `ensureLaunchInstallInCMake` to inject unconditional `install(DIRECTORY launch DESTINATION share/${PROJECT_NAME} OPTIONAL)` and `config` directives without configure-time `if(EXISTS ...)` gates.
  - Added automatic migration that detects legacy `if(EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/launch")` blocks in existing `CMakeLists.txt` files and upgrades them to the unconditional `OPTIONAL` directives.
  - Added `ensureLaunchDepsInPackageXml` to automatically inject `<exec_depend>launch</exec_depend>`, `<exec_depend>launch_ros</exec_depend>`, and `<exec_depend>ament_index_python</exec_depend>` into existing `package.xml` files when system launch files are added.
- **Casing Conversion Utilities**:
  - Exported `toCamelCase` and `toSnakeCase` utility functions matching Xtext generator conventions for reliable artifact and file resolution.
- **Automated Test Suite Expansion**:
  - Added comprehensive test suite in `buildCleanup.test.ts` covering CMake cleanup, pure Python cleanup, launch directives injection, legacy `if(EXISTS)` upgrade to `OPTIONAL`, casing transformations, and opposite-language file pruning.
  - Added end-to-end regression test in `lspGrammarValidator.test.ts` verifying package-scoped file persistence.

### Changed
- **Package-Scoped File Scanning for Wrapper Generation**:
  - Scoped `existingFiles` directory scan in `ros2.generateWrappers` to `src-gen/<pkgName>` instead of the entire workspace `src-gen`.
  - Moving algorithm or logic stubs outside the package folder ensures they are cleanly regenerated within the package without false persistence retention.
- **Aligned Executable Naming Scheme (Approach A)**:
  - Canonical executable names matching `.ros2` modeled artifact names (`«node.artifactName»`) across pure C++, pure Python, and hybrid packages.
  - In hybrid CMake packages, runners are installed with CMake `RENAME «node.artifactName»`, ensuring launch file specifications without `.py` suffix resolve correctly.
- **Removed "Both (C++ & Python)" Duplicate Generation**:
  - Removed "Both" option to enforce single-language implementation per node and eliminate executable and launch conflicts.
- **Workspace-Aware System Generation**:
  - Updated `rossystem.triggerCodeGeneration` to pass `existingFiles` to the Language Server, preserving existing node wrappers and build targets.

### Fixed
- **Launch File Installation on Post-Generation**:
  - Resolved missing launch file in `install/` after generating system launch files into packages configured with CMake before the `launch/` directory existed.
  - By using `OPTIONAL` directory installation, CMake unconditionally registers install rules at configure time, guaranteeing that subsequent `colcon build` commands install and symlink launch files immediately upon creation.
- **RosSystem Node Reference Alignment (`from: pkg.node`)**:
  - Fixed parser (`RosModelParser.ts`), catalogue indexer (`RosCatalogueManager.ts`), and emitter to correctly reference node definitions (`from: pkg.node`) instead of artifact names (`pkg.artifact`), strictly adhering to Xtext grammar specifications.
  - Fixed RosTooling Studio visual editor and component inspector to accurately display and wire node definitions vs artifact targets.
  - Preserved distinct artifact references in `.rossystem` when node label, `from:`, and artifact name differ.
- **Synchronized Version Declarations**:
  - Synchronized extension version across `gradle.properties` (`version=2.2.0`), `package.json` (`"version": "2.2.0"`), and changelogs.

## [2.1.1] - 2026-10-03

### Fixed
- **Dynamic Xtext FAT JAR Version Management**:
  - Removed hardcoded version numbers for Xtext-based ROS2 DSL language (e.g., `ros1.xtext`, `ros2.xtext`).
  - Language server dependencies in `build.gradle` now reference the `project.ext.version` variable.

## [2.1.0] - 2026-09-30

### Added
- **ROS 2 Node Wrapper & Logic Code Generation**:
  - Interactive Command Palette command (`ros2.generateWrappers`) to generate C++ and Python node wrappers, executable runners, and pure logic templates from `.ros2` models.
  - RosTooling Studio visual editor integration with a dedicated "Generate Wrappers" action button in the component inspector.
  - Automatic `chmod 0o755` executable permissions for generated Python runners and files containing shebangs on non-Windows platforms, enabling immediate execution with `colcon build --symlink-install`.
  - Artifact-aware generation resolving modeled artifact names for generated C++ and Python filenames and build scripts.
- **Pre-Launch Catalogue Synchronization**:
  - Automatic verification and synchronization of default catalogue repositories (`RosModelsCatalog`, `RosCommonObjects`) prior to starting the Java Language Server.
  - Fallback cache copying from `~/.rostooling/catalogue_repos` to prevent startup race conditions or missing model dependencies in multi-root workspaces.
- **Explicit Extension Activation Events**:
  - Registered `onCommand` triggers for `ros2.generateWrappers`, `rostooling.openVisualStudio`, `rossystem.triggerCodeGeneration`, `rossdl.buildPackage`, and `onCustomEditor:rostooling.visualStudio`.
- **Demo & Testing Packages**:
  - Added ROS 2 example fixtures under `demo/test_ws/src/` including `custom_action_interfaces` (`Fibonacci.action`), minimal action, minimal publisher, subscriber, and service models.

### Changed
- Refactored wrapper generation command registration to use `ros2.generateWrappersServer` internally, preventing command identifier collisions between the VS Code client and the LSP server.
- Wrapped all custom command registrations with a `safeRegisterCommand` guard to avoid duplicate registration exceptions during dynamic extension reloads.
- **Monolithic & Multi-Package Build Protection**:
  - `rossystem.triggerCodeGeneration` now scans existing files in `src-gen/<pkg>` and sends them to `rossystem.generateCode`.
  - Added overwrite guards preventing `rossystem.triggerCodeGeneration` from clobbering compiled C++ targets in `CMakeLists.txt` or `console_scripts` entry points in `setup.py`.
  - Prevented rogue `CMakeLists.txt` generation in pure Python packages.
  - Automatically cleans up obsolete conflicting build files (e.g. leftover `CMakeLists.txt` in pure Python packages or leftover `setup.py` in C++ packages) when generating node wrappers.

## [2.0.0] - 2026-09-16

### Added
- **RosTooling Studio (Visual Editor)**:
  - Interactive diagram canvas for `.rossystem`, `.ros2`, `.ros1`, and `.ros` domain-specific languages.
  - Custom editor provider registered for `rostooling.visualStudio`.
  - Graph icon button (`$(graph)`) and context menu integration to launch the Studio.
  - Smooth pan and zoom-to-cursor navigation with view state persistence in `.rostooling/layout/*.layout.json`.
- **System View (`.rossystem`)**:
  - Interactive multi-node and subsystem layout assembly.
  - Drag-and-drop wire connections between ports with automatic direction orientation.
  - Real-time connection validation checking port kinds and compatible communication types.
  - Collapsible and expandable subsystem frames.
  - Inspector panel for launch parameters, parameter value overrides, and interface remappings.
  - Dynamic import of nodes from workspace packages and external catalogue models.
- **Component View (`.ros2` / `.ros1`)**:
  - Visual component card editor for ROS 1 and ROS 2 nodes.
  - Dynamic management of Publishers, Subscribers, Service Servers/Clients, Action Servers/Clients, and Parameters.
  - Full **Quality of Service (QoS)** support: dropdown configuration for Reliability, Durability, History, Depth, Liveliness, Lease Duration, and Deadline with automatic YAML/DSL formatting.
- **Communication Objects View (`.ros`)**:
  - UML Type Schema diagrams for Message, Service, and Action specifications.
  - Type dependency links and clean synchronization with `.ros` grammar.
- **Catalogue Manager**:
  - Integration with `RosModelsCatalog` and `RosCommonObjects` libraries.
  - Multi-root catalogue indexing, automatic background discovery, and dynamic reloading.
  - Read-only protection badges and permission enforcement for core catalogue models.
- **ROS 2 Commands**:
  - `ROSSDL: Build ROS 2 Package` command for building packages with `colcon`.
- **Testing & Continuous Integration**:
  - Automated test suite comprising 109 unit, integration, and LSP protocol tests.
  - Headless Linux test execution using `xvfb-run`.
  - GitHub Actions CI workflow for automated compilation, linting, and test execution.

### Changed
- Bumped extension version to `2.0.0`.
- Enhanced Language Server startup with dynamic fat JAR detection and improved error reporting.
- Modernized documentation with manual VSIX installation instructions from GitHub Releases.

### Fixed
- Fixed subsystem connection persistence when connecting nodes directly to subsystem ports.
- Fixed dynamic node definition synchronization so changes in companion `.ros2` models immediately reflect in system diagrams.
- Fixed cyclic dependency handling during Language Server initialization with multi-root workspaces.
- Resolved canvas freeze issues during panning by decoupling event listeners and optimizing render cycles.

## [1.1.0] - 2026-04-01

### Added
- Added ROS 2 package generation feature. Users can generate complete ROS 2 packages directly from their `.rossystem` files using the Command Palette (`ROSSYSTEM: Generate ROS 2 Package`).

## [1.0.1] - 2026-03-05

### Fixed
- Fixed extension versioning to automatically synchronize and read from the `package.json` file.

## [1.0.0] - 2026-03-01

### Added
- Initial release of the RosTooling language support extension.
- Syntax highlighting and bracket colorization for `.ros`, `.ros1`, `.ros2`, and `.rossystem`.
- Code completion and content assist powered by the Eclipse Xtext RosLanguageServer.
- Real-time semantic diagnostics and model validation.
