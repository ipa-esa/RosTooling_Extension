# Change Log

All notable changes to the "rostooling-languages" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.4.0] - 2026-11-13

### Added
- **Java GLSP Server Integration & Sprotty Webview (`GlspClientBridge`, `WebviewGlspServer`, `rosDiagram.ts`, `rosViews.tsx`)**:
  - Hosted `de.fraunhofer.ipa.ros.glsp` inside the language server fat JAR (`build.gradle`) and routed logs cleanly via `log4j2.xml` to keep LSP/GLSP `stdout` protocol-only.
  - Migrated `.rossystem`, `.ros2`, and `.ros` webviews (`RosSystemView.jsx`, `RosComponentView.jsx`, `RosCommObjectsView.jsx`) to render server GGraph models and dispatch GLSP operations.
  - Added orthogonal wire line-jump rendering, collapsed subsystem boundary ports, and headless server-layouted SVG export (`GGraphSvgRenderer.ts`).
- **Coordinate-Free Semantic MCP Authoring Tools (`mcp/systemTools.ts`, `mcp/packageTools.ts`, `mcp/mcpGlspSession.ts`)**:
  - Added `.rossystem` tools: `ros_add_node` (with `from_file`), `ros_add_subsystem`, `ros_set_system_property`, `ros_connect_interfaces`, `ros_set_parameter`, `ros_add_process`, `ros_remove_element`, and `export_system_diagram`.
  - Added `.ros2` and `.ros` tools: `ros2_add_artifact`, `ros2_add_interface`, `ros2_add_parameter`, `ros2_set_qos`, `ros2_set_property`, `ros2_remove_element`, and `ros_add_spec`.
  - Added end-to-end integration tests (`glspIntegration.test.ts`, `mcpSystemTools.test.ts`, `mcpPackageTools.test.ts`).

### Fixed
- **Canvas Panning & Selection Drag Behaviour**:
  - Suppressed sub-pixel/pan-triggered drags in `ChangeBoundsListener` so panning the canvas with a selected node no longer moves or pins it.

### Removed
- **Legacy TypeScript DSL & React Flow Pipeline**:
  - Removed `RosModelParser.ts`, `RosModelEmitter.ts`, `RosLayoutManager.ts`, `ConnectionValidator.ts`, `orthogonalRouter.js`, and duplicate Java validator/scoping/QNP overrides in favor of the authoritative Java GLSP/Xtext server.

## [2.3.5] - 2026-11-10

### Added
- **Canvas Error Boundary & Crash Protection**:
  - Implemented `ErrorBoundary.jsx` around visual editor components (`SystemCanvasInner`, `SystemInspector`, and the root application view) to prevent React 18 from unmounting into a blank canvas when unexpected component errors occur.
  - Added an inline error recovery banner with a "Recover Canvas" action that restores visual editor state without reloading the document.

### Fixed
- **Subsystem Connection Persistence & Multi-Source Wiring**:
  - Ensured interactive connections from subsystem nodes derive fully-qualified endpoints (`subsystem::node::interface`), enabling newly created connections to persist on reload and round-trip cleanly through `RosModelEmitter` and `RosModelParser`.
  - Replaced aggressive target-port pruning with duplicate detection in `RosSystemView.jsx`, preserving pre-existing connections from real hardware subsystems when wiring alternative or multiple simulation sources (e.g. sim `/tf` alongside real `/tf`).
- **Edge Routing & Inspector Coordinate Safety**:
  - Added coordinate validation guards in `JumpOrthogonalEdge.jsx` and `orthogonalRouter.js` to safely handle `undefined`, `null`, and `NaN` coordinates without throwing SVG render errors.
  - Guarded node resolution and button actions in `SystemInspector` to prevent null-dereference errors when inspecting connections with composite or unmapped endpoints.
- **Document Edit Range Clamping**:
  - Applied `document.validateRange(...)` to workspace edits in `RosCustomEditorProvider.ts` to prevent out-of-bounds `Range` errors during model synchronization.

## [2.3.4] - 2026-11-09

### Added
- **Automated Parent System Connection Synchronization**:
  - Implemented `syncParentSystemsOnSubsystemSave` in `RosCustomEditorProvider.ts` to automatically detect when a subsystem `.rossystem` model is saved, locate all parent `.rossystem` models in the workspace referencing it, and update remapped connection endpoints in place without requiring manual rewiring.
  - Automatically persists connection remapping updates to open documents and disk when loading or refreshing models, preventing `Couldn't resolve reference to RosInterface` errors.
- **Bundled Agent Skills & Python Hooks Packaging**:
  - Embedded RosTooling agent skills, Python hooks, and CLI scripts into the extension build (`.agents/skills`, `.agents/scripts`, `.agents/hooks`).
  - Added automatic installation command and tests for multi-IDE workflows (Claude Code, Antigravity, Cursor).
  - Updated CI packaging workflows to bundle skills without requiring an external repository clone.
- **Automatic LSP JAR and VSIX Build Cleanup**:
  - Enhanced Gradle build tasks (`copyFatJar`, `vscodeExtension`) to automatically clean up older language server JAR versions and superseded VSIX archives.

### Fixed
- **Visual Editor Auto-Save Debouncing & Responsiveness**:
  - Implemented 300ms auto-save debouncing in `studioStore.js` with `flushPendingEdits()` on blur, undo, redo, and discrete canvas interactions, eliminating keystroke loss and input race conditions.
  - Added bounded workspace root discovery in `getWorkspaceRoots()` and in-memory caching for companion artifacts to eliminate filesystem traversal lag across user directories.
- **Model Round-Trip Fidelity & Code Generation Validation**:
  - Preserved system-level parameters block (`parameters:`), list values (`[a, b, c]`), inline `#` comments, and quote styles when saving `.rossystem` files.
  - Enforced pre-flight model validation in generator command services, preventing code generation when model errors are present.

### Changed
- Updated RosTooling backend dependency to `3.3.3-SNAPSHOT`.

## [2.3.3] - 2026-11-07

### Added
- **Automated Subsystem Model Interface Synchronization**:
  - Implemented `syncSubsystemModels` in `RosCustomEditorProvider.ts` to automatically update companion subsystem `.rossystem` models when connections are wired in the GUI to unexposed subsystem interfaces.
  - Inserts missing interfaces into the subsystem node's `interfaces:` block in canonical kind order (`pub` -> `sub` -> `ss` -> `sc` -> `as` -> `ac`), preventing `Couldn't resolve reference to RosInterface` errors.

## [2.3.2] - 2026-11-06

### Added
- **Semicolon Connection Syntax Support**:
  - Enhanced `RosModelParser.ts` to parse connection lines delimited by semicolons (`- [from; to]`, `- from; to`, and trailing semicolons).
- **Launch Substitution Parameter Diagnostics**:
  - Updated `RosSystemValidator.java` language server overlay with validation checks for launch substitution expressions (`$(...)`) inside parameter definitions.
- **Dependency Update**:
  - Updated RosTooling backend dependency to `3.3.2-SNAPSHOT`.

## [2.3.1] - 2026-11-06
Nothing added, changed or fixed. Just a patch to circumvent the marketplace deleted but cached version.

## [2.3.0] - 2026-11-03

### Added
- **React Flow Visual Studio Overhaul**:
  - Replaced legacy SVG/canvas webview implementation with a modular React 19 + `@xyflow/react` (React Flow) architecture bundled via an optimized esbuild pipeline.
  - Implemented specialized interactive views:
    - **`RosSystemView` (.rossystem)**: Interactive multi-node system composition, expandable/collapsible subsystem container cards, process group container nodes, orthogonal jump wire routing (`JumpOrthogonalEdge`), dynamic drag-and-drop wire creation, and canvas navigation controls (zoom, pan, fit view, minimap, search filtering).
    - **`RosComponentView` (.ros2 / .ros1)**: Interactive component modeling for nodes, interfaces, and parameters; full support for publisher/subscriber QoS profile dropdown selectors (reliability, durability, history, depth, liveliness, deadline, lifespan, lease duration), LifecycleNode state configurations, and live syntax validation.
    - **`RosCommObjectsView` (.ros)**: Interactive UML type schema cards for ROS communication objects (messages, services, and actions) with dynamic nested type dependency tracking and links.
    - **`CatalogueDrawer`**: Integrated sliding drawer to search, browse, and drag-and-drop off-the-shelf nodes from `RosModelsCatalog` and message/service/action communication types from `RosCommonObjects`.
- **Scoped Remapped Interface Resolution (`<node>::<interface>`)**:
  - Added support in parser and emitter for double-colon scoped interfaces in `.rossystem` connection definitions (`<node>::<interface>` and `<subsystem>::<node>::<interface>`).
  - Implemented duplicate interface collision detection: automatically qualifies connection endpoints when multiple nodes or subsystems share identically named interfaces, while preserving clean unqualified names when interfaces are unique.
  - Subsystem member node scoping: accurately scopes remapped interfaces across loaded subsystem graphs during connection emission.

### Changed
- **Frontend Architecture & Build Pipeline**:
  - Integrated standalone frontend build tooling inside `src/webview/frontend` with React 19, Lucide React icons, and `@xyflow/react`.
  - Added `npm run build:webview` and integrated it directly into root `npm run compile` and CI build scripts.
  - Replaced monolithic `studioHtml.ts` with lightweight `getStudioHtml` shell injecting the compiled React Flow bundle (`dist/studio.js` and `dist/studio.css`).
- **Synchronized Version Declarations**:
  - Bumped version to `2.3.0` across `package.json`, `package-lock.json`, `gradle.properties`, MCP server, and changelog.

### Fixed
- **Direction / Role-Aware Connection Endpoint Resolution**:
  - Enforced directional port roles during unqualified interface resolution in `RosModelParser`: connection `from` endpoints strictly match output ports (`pub`, `ss`, `as`), and `to` endpoints strictly match input ports (`sub`, `sc`, `ac`).
  - Prevents top-level subscriber ports from erroneously binding as the source of a connection during initial AST parsing prior to subsystem expansion.
- **Connection Deletion Synchronization & Layout Cache Resurrection**:
  - Removed connection resurrection loop in `RosCustomEditorProvider.restoreCachedLayout`: deleting a connection line in the `.rossystem` text editor immediately updates the visual studio without being resurrected from cached layout state.
  - Scoped layout cache restoration strictly to visual layout attributes (`midX`, `midY`, `connectorMode`, `waypoints`) for existing connections.
- **Invalid Self-Loop Connection Filtering**:
  - Filtered out invalid self-connections where a node connects an interface to itself across `RosModelParser`, `RosCustomEditorProvider`, `RosModelEmitter`, and React Flow edge generation.
- **Connection Deduplication**:
  - Added automatic deduplication of identical connection pairs in `RosModelEmitter.emitRosSystem`.
- **CI Build & Headless Testing**:
  - Resolved `esbuild` path resolution and dependency availability in GitHub Actions workflows.
  - Updated CI test workflow to run VS Code extension tests headlessly using `xvfb-run`.

## [2.2.1] - 2026-10-28

### Added
- **Multi-IDE Fallback Cache Discovery**:
  - Added discovery and copying of cached catalogue repositories across common local user storage paths (`~/.rostooling/catalogue_repos` as well as IDE `globalStorage` locations across Antigravity IDE, VS Code, and VSCodium for `rostooling.rostooling-languages`), enabling immediate offline access and preventing redundant downloads.
- **Dynamic Language Server JAR Resolution Fallback**:
  - Added dynamic fallback discovery in `server/` when launching the Language Server client. If the exact versioned JAR (`rostooling_extension-${extensionVersion}.jar`) is not present in development or local builds, the extension automatically locates and loads any available JAR in `server/`.

### Fixed
- **Blocking Catalogue Download on Clean Install**:
  - Fixed issue where installing the extension on clean environments (such as from Open VSX or VSCodium) caused the ROS Language Server to launch immediately against an empty catalogue path before default models (`RosModelsCatalog` and `RosCommonObjects`) finished syncing in the background, producing dozens of unresolved reference diagnostics when opening demo workspaces.
  - Initial catalogue synchronization is now awaited via a modal progress notification prior to Language Server initialization when repositories are absent.
- **Companion Artifact Parsing for `.ros` Definition Files**:
  - Excluded `.ros` files (which define ROS message, service, and action specifications) from `parseRos2()` in `RosCustomEditorProvider.loadCompanionArtifacts`, preventing erroneous parsing attempts and corrupted artifact state.
- **Portable Local Storage Paths**:
  - Replaced hardcoded local development paths in `RosCustomEditorProvider` and test suites with dynamic `os.homedir()` and standard `~/.rostooling/catalogue_repos` paths.
- **Deprecated Publisher Cleanup**:
  - Strictly discontinued support for the legacy `fraunhoferipa` publisher; standardized entirely on the official `RosTooling` publisher namespace.

## [2.2.0] - 2026-10-15
### Added
- **Composable Component & Process Support**:
  - Full parser and emitter support for `.rossystem` `processes:` section with node lists and thread counts.
  - Bundled updated Language Server fat JAR containing composable component launch file generation (`ComposableNodeContainer` with `component_container_mt` / `component_container`) and validation rules.
  - Added LSP test cases verifying `.rossystem` process definitions and diagnostics against duplicate node process assignment.
- **Node Decoupling & C++ Component Architecture Support**:
  - Extended opposite-language file pruning (`cleanOppositeLanguageFiles`) to remove decoupled `<Node>Node.hpp` and `<Node>Node.cpp` component files when switching a node to Python.
- **Unconditional `OPTIONAL` Launch & Configuration Installation (`ensureLaunchInstallInCMake`)**:
  - Updated `ensureLaunchInstallInCMake` to inject unconditional `install(DIRECTORY launch DESTINATION share/${PROJECT_NAME} OPTIONAL)` and `config` directives without configure-time `if(EXISTS ...)` gates.
  - Added automatic migration that detects legacy `if(EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/launch")` blocks in existing `CMakeLists.txt` files and upgrades them to the unconditional `OPTIONAL` directives.
- **Automated Test Suite Expansion**:
  - Added comprehensive test suite in `buildCleanup.test.ts` covering legacy `if(EXISTS)` upgrade to `OPTIONAL` and component node pruning.
  - Added end-to-end regression test in `lspGrammarValidator.test.ts` verifying package-scoped file persistence.
  - Added parser/emitter round-trip tests in `modelParserEmitter.test.ts` for `.rossystem` process definitions and composable container configurations.
### Changed
- **Package-Scoped File Scanning for Wrapper Generation**:
  - Scoped `existingFiles` directory scan in `ros2.generateWrappers` to `src-gen/<pkgName>` instead of the entire workspace `src-gen`.
  - Moving algorithm or logic stubs outside the package folder ensures they are cleanly regenerated within the package without false persistence retention.
### Fixed
- **Launch File Installation on Post-Generation**:
  - Resolved missing launch file in `install/` after generating system launch files into packages configured with CMake before the `launch/` directory existed.
  - By using `OPTIONAL` directory installation, CMake unconditionally registers install rules at configure time, guaranteeing that subsequent `colcon build` commands install and symlink launch files immediately upon creation.
- **Synchronized Version Declarations**:
  - Synchronized extension version across `gradle.properties` (`version=2.2.0`), `package.json` (`"version": "2.2.0"`), and changelogs.
## [2.1.3] - 2026-10-13
### Added
- **Open VSX Registry Publishing Workflow**:
  - Integrated Open VSX publishing via Trusted Publishing (OIDC) into GitHub Actions (`gradle-publish.yml`).
  - Added manual execution support via `workflow_dispatch` trigger with a `publish_openvsx` toggle input for CI testing and manual deployment.
  - Added CI build artifact upload for `.vsix` packages to enable downloading and inspecting builds directly from GitHub Actions.
- **Open VSX Documentation & Badges**:
  - Added Open VSX version badges to project documentation.
  - Added Open VSX Registry installation instructions (via Extensions view and `codium` CLI) as the primary recommended method.
### Changed
- **Repository Directory Declaration**:
  - Added `"directory": "rostooling-languages"` to the `repository` field in `package.json` to properly declare the extension's monorepo subfolder path.
- **Updated RosModelsCatalog Link**:
  - Updated the catalog repository reference in documentation to `https://github.com/NadiaHG/RosModelsCatalog`.
### Fixed
- **Open VSX README Asset Rendering**:
  - Resolved broken image rendering for the extension header logo on Open VSX by using an absolute raw GitHub asset URL.
- **Release Step Guard in CI**:
  - Guarded GitHub Release upload with `if: github.event_name == 'release'` to prevent CI job failures when executing manual workflow dispatches.
## [2.1.2] - 2026-10-13
### Added
- **Single-Language Node Selection & Interactive Wrapper Generation**:
  - Interactive language selection prompt when generating node wrappers from `.ros2` models:
    - Single-node packages: Select directly between `C++` and `Python`.
    - Multi-node packages: Select between `All C++`, `All Python`, or `Configure per node...`.
  - Added per-node configuration prompt allowing users to assign implementation languages individually across nodes in a monolithic package.
  - Multi-step hybrid generator coordination: generates C++ nodes and Python nodes seamlessly within a unified run, combining build scripts into hybrid `ament_cmake_python` configurations.
- **Node-Level Opposite-Language File Pruning (`cleanOppositeLanguageFiles`)**:
  - Added automated pruning of opposite-language source, runner, and logic files on disk when a node's implementation language is switched.
  - Switching to C++ prunes obsolete Python files (`<node>_wrapper.py`, `<node>_runner.py`, `<node>_logic.py`) and deletes the package folder if no other Python nodes remain.
  - Switching to Python prunes obsolete C++ files (`<Node>Wrapper.hpp`, `<Node>Algorithm.hpp`, `<Node>Wrapper.cpp`, `<Node>Runner.cpp`) and deletes empty `src/` and `include/` directories.
  - Strictly preserves files belonging to other companion nodes in hybrid packages.
- **Automated Redundant Build & Setup File Cleanup (`cleanRedundantBuildFiles`)**:
  - Automatically prunes conflicting build and setup files (`setup.py`, `setup.cfg`, `pyproject.toml`, and setuptools marker `resource/<pkg>`) when regenerating as CMake / Hybrid packages, eliminating Pyright PEP 517 src-layout module resolution errors.
  - Automatically prunes obsolete `CMakeLists.txt` and `pyproject.toml` when regenerating pure Python packages.
  - Strictly preserves PlantUML architecture diagrams (`resource/<pkg>.puml`) from deletion across all build cleanup routines.
- **Launch and Configuration Installation Injections**:
  - Added `ensureLaunchInstallInCMake` to automatically inject `install(DIRECTORY launch ...)` and `config/` directives into existing `CMakeLists.txt` for monolithic packages lacking them.
  - Added `ensureLaunchDepsInPackageXml` to automatically inject `<exec_depend>launch</exec_depend>`, `<exec_depend>launch_ros</exec_depend>`, and `<exec_depend>ament_index_python</exec_depend>` into existing `package.xml` files when system launch files are added.
- **Casing Conversion Utilities**:
  - Exported `toCamelCase` and `toSnakeCase` utility functions matching Xtext generator conventions for reliable artifact and file resolution.
- **Automated Test Suite Expansion**:
  - Added comprehensive test suite in `buildCleanup.test.ts` covering CMake cleanup, pure Python cleanup, launch directives injection, casing transformations, and opposite-language file pruning.
### Changed
- **Aligned Executable Naming Scheme (Approach A)**:
  - Canonical executable names matching `.ros2` modeled artifact names (`«node.artifactName»`) across pure C++, pure Python, and hybrid packages.
  - In hybrid CMake packages, runners are installed with CMake `RENAME «node.artifactName»`, ensuring launch file specifications without `.py` suffix resolve correctly.
- **Removed "Both (C++ & Python)" Duplicate Generation**:
  - Removed "Both" option to enforce single-language implementation per node and eliminate executable and launch conflicts.
- **Workspace-Aware System Generation**:
  - Updated `rossystem.triggerCodeGeneration` to scan `src-gen` and pass `existingFiles` to the Language Server, preserving existing node wrappers and build targets.
### Fixed
- **RosSystem Node Reference Alignment (`from: pkg.node`)**:
  - Fixed parser (`RosModelParser.ts`), catalogue indexer (`RosCatalogueManager.ts`), and emitter to correctly reference node definitions (`from: pkg.node`) instead of artifact names (`pkg.artifact`), strictly adhering to Xtext grammar specifications.
  - Fixed RosTooling Studio visual editor and component inspector to accurately display and wire node definitions vs artifact targets.
  - Preserved distinct artifact references in `.rossystem` when node label, `from:`, and artifact name differ.
- **Synchronized Version Declarations**:
  - Synchronized versions across `gradle.properties` (`version=2.1.2`), `build.gradle` (`version = '3.2.1-SNAPSHOT'`), and `package.json` (`"version": "2.1.2"`).

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
