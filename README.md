# RosTooling Extension for Visual Studio Code

[![CI](https://github.com/ipa-esa/RosTooling_Extension/actions/workflows/ci.yml/badge.svg)](https://github.com/ipa-esa/RosTooling_Extension/actions/workflows/ci.yml)
[![Gradle Package](https://github.com/ipa-esa/RosTooling_Extension/actions/workflows/gradle-publish.yml/badge.svg)](https://github.com/ipa-esa/RosTooling_Extension/actions/workflows/gradle-publish.yml)

![RosTooling Extension](rostooling-languages/images/RosTooling_Badge.png)

## Overview

**RosTooling_Extension** is a Visual Studio Code extension designed to provide a comprehensive, model-driven engineering environment for robotics development using [RosTooling](https://github.com/ipa320/RosTooling) domain-specific languages (DSLs): `.ros`, `.ros1`, `.ros2`, and `.rossystem`.

The extension combines rich language intelligence (powered by an Eclipse Xtext Language Server) with **RosTooling Studio**—an interactive visual diagramming and system architecture editor built directly into VS Code.

---

## Features

### 1. RosTooling Studio (Visual Architecture Editor)
Open any RosTooling model in a graphical studio with dedicated views:
- **System View (`.rossystem`)**:
  - Drag-and-drop system assembly of nodes and hierarchical subsystems.
  - Interactive wire routing between interfaces with real-time port compatibility checking (kind and message type matching).
  - Collapse and expand subsystem frames to keep large architectures clean.
  - Configure launch parameters, set parameter overrides, and remap interface names directly in the inspector panel.
  - Import nodes from both the active workspace and external catalogue repositories.
- **Component View (`.ros2` / `.ros1`)**:
  - Visual node component modeling cards.
  - Add, edit, and delete interfaces (Publishers, Subscribers, Service Servers/Clients, Action Servers/Clients) and parameters.
  - Full **Quality of Service (QoS)** configuration: dropdown selectors for Reliability, Durability, History, Depth, Liveliness, Lease Duration, and Deadline with automatic serialization.
- **Communication Objects View (`.ros`)**:
  - UML Type Schema diagrams for Messages, Services, and Actions.
  - Visualize and edit cross-type dependencies and package associations.
- **Live Bi-directional Synchronization**:
  - Visual changes instantly update the underlying DSL text files.
  - Modifying node definitions dynamically updates companion system views and diagrams.

### 2. Language Server & Code Intelligence
- **Code Completion (`Ctrl+Space`)**: Intelligent content assist for packages, artifacts, interfaces, parameters, and communication types.
- **Syntax Highlighting & Bracket Matching**: Colorized grammar definitions for `.ros`, `.ros1`, `.ros2`, and `.rossystem`.
- **Real-Time Validation & Diagnostics**: Semantic validation powered by the Xtext RosLanguageServer with in-editor error and warning markers.

### 3. Catalogue Management
- Built-in integration with the [RosModelsCatalog](https://github.com/ipa-nhg/RosModelsCatalog) and [RosCommonObjects](https://github.com/ipa320/RosCommonObjects) libraries.
- Automatic background indexing of reusable standard robots, drivers, and common message sets.
- Visual badges denoting core catalogue models with read-only protection to prevent unintentional edits.

### 4. ROS 2 Package Generation & Build
- **Code Generation**: Transform `.rossystem` models into complete, buildable ROS 2 packages (nodes, launch files, CMakeLists.txt, package.xml) via the Command Palette or the Studio toolbar.
- **Package Build**: Trigger a `colcon build` of generated ROS 2 packages directly from VS Code.

---

## Installation

### Option 1: Install from GitHub Release (Recommended)

Pre-packaged `.vsix` releases are available on the repository's GitHub Releases page.

1. **Download the VSIX**:
   Visit the [GitHub Releases](https://github.com/ipa-esa/RosTooling_Extension/releases) page and download the latest `rostooling-languages-<version>.vsix` asset.

2. **Install into VS Code** using one of the following methods:

   #### Method A: Via the VS Code User Interface
   1. Open Visual Studio Code.
   2. Open the **Extensions** view by clicking the Extensions icon on the Activity Bar on the left or pressing `Ctrl+Shift+X` (macOS: `Cmd+Shift+X`).
   3. Click the **Views and More Actions** menu (`...`) in the top-right corner of the Extensions pane.
   4. Select **Install from VSIX...**.
   5. Browse to and select your downloaded `rostooling-languages-<version>.vsix` file.

   #### Method B: Via the Command Palette
   1. In VS Code, open the Command Palette by pressing `Ctrl+Shift+P` (macOS: `Cmd+Shift+P`).
   2. Type **`Extensions: Install from VSIX...`** and press `Enter`.
   3. Select the downloaded `.vsix` file from the file picker.

   #### Method C: Via the Command Line (CLI)
   Run the following command in your terminal:
   ```bash
   code --install-extension rostooling-languages-<version>.vsix
   ```
   *(Note: If you are using VSCodium or Antigravity IDE, replace `code` with `codium` or your respective executable).*

---

### Option 2: Build and Install from Source

To build and package the extension from source:

1. **Clone the repository**:
   ```bash
   git clone https://github.com/ipa-esa/RosTooling_Extension.git
   cd RosTooling_Extension
   ```

2. **Build the Language Server JAR and package the extension**:
   ```bash
   ./gradlew installExtension
   ```
   Or manually package using npm and vsce:
   ```bash
   ./gradlew copyFatJar
   cd rostooling-languages
   npm ci
   npm run compile
   npx @vscode/vsce package --no-dependencies
   code --install-extension build/vscode/rostooling-languages-*.vsix
   ```

---

## Getting Started

1. Open a workspace containing RosTooling files (for an example, open `demo/test_ws`).
2. **Open in RosTooling Studio**:
   - Right-click any `.rossystem`, `.ros2`, `.ros1`, or `.ros` file in the File Explorer or editor tab and select **"Open in RosTooling Visual Studio"**.
   - Alternatively, click the graph icon (`$(graph)`) in the top-right editor title bar, or open the Command Palette (`Ctrl+Shift+P`) and choose `RosTooling: Open in RosTooling Visual Studio`.
3. **Generate a ROS 2 Package**:
   - Open a `.rossystem` model and click the **Generate ROS 2 Package** button in the studio toolbar, or run `ROSSYSTEM: Generate ROS 2 Package` from the Command Palette (`Ctrl+Shift+P`).
4. **Build the Generated Package**:
   - Run `ROSSDL: Build ROS 2 Package` from the Command Palette.

---

## Requirements

- **Visual Studio Code**: version 1.107.0 or higher.
- **Java**: JDK 21 or later (required by the Language Server).
- **Operating System**: Linux (Ubuntu 22.04 LTS or later recommended) or macOS.
- **ROS 2**: Humble, Iron, Jazzy, or Rolling (required for building and executing generated packages).

---

## Extension Settings

This extension contributes the following settings:

| Setting | Description | Default |
|---|---|---|
| `rostooling-languages.java.home` | Absolute path to the JDK 21+ installation directory. Leave empty to use system default Java. | `""` |
| `rostooling-languages.server.trace` | Verbosity of the language server trace output (`off`, `messages`, `verbose`). | `"off"` |

---

## Development & Testing

### Running Tests
The extension contains an automated test suite with unit, integration, and LSP protocol tests:
```bash
cd rostooling-languages
npm ci
npm test
```
To run tests in a headless Linux environment:
```bash
cd rostooling-languages
xvfb-run -a npm test
```
Or via Gradle:
```bash
./gradlew :rostooling-languages:npm_test
```

### Debugging the Extension
1. Open the repository in Visual Studio Code.
2. Open the **Run and Debug** view (`Ctrl+Shift+D`).
3. Select **Run Extension** and press `F5`. This launches an Extension Development Host window with the extension loaded.

---

## Contributing

1. Fork the repository.
2. Create a feature branch (`git checkout -b feature/my-feature`).
3. Ensure all tests and linting pass (`npm run compile && npm run lint && npm test`).
4. Commit your changes (`git commit -m 'feat: my new feature'`).
5. Push to the branch (`git push origin feature/my-feature`).
6. Open a Pull Request against `main` or the active feature branch.

---

## Support & Issues

For bugs, questions, and feature requests, please file an issue on the [GitHub Issues](https://github.com/ipa-esa/RosTooling_Extension/issues) page.

---
Maintained by Fraunhofer IPA ([ipa-esa](https://github.com/ipa-esa))
