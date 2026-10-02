# Change Log

All notable changes to the "rostooling-languages" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
