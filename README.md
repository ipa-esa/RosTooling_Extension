# RosTooling_Extension

## Overview

RosTooling_Extension is a Visual Studio Code extension designed to enhance development experience for [RosTooling](https://github.com/ipa320/RosTooling.git) languages. It provides the similar content assist functionalities available in Eclipse.

## Features

- Code completion for ROS files
- Syntax highlighting [TODO]

## Installation

1. Clone this RosTooling [repository](https://github.com/ipa-esa/RosTooling.git)
```bash
git clone -b esa/main git@github.com:ipa-esa/RosTooling.git 
```
2. Build and install the RosTooling project.
```bash
cd RosTooling/plugins/de.fraunhofer.ipa.ros.parent/
mvn clean install
```
3. Navigate to the root of this repository and build the fatjar
```bash
cd RosTooling_Extension
./gradlew clean copyToVscode
```
4. Navigate to the extension directory and install the extension in VS Code
```bash
cd rostooling-languages
npm install
npm run compile
```
5. Open the extenstion in VS Code and press `F5` to launch the extension in a new VS Code window.
```bash
code .
```
6. You can now open/start a project to model your ROS package!

## Usage

- Open a ROS workspace in VS Code.
- Access ROS commands from the Command Palette (`Ctrl+Shift+P`).
- Use the sidebar for workspace and package management.
- Configure settings in `.vscode/settings.json` for custom behaviors.

## Requirements

- Visual Studio Code (latest version recommended)
- ROS (Melodic, Noetic, or later)
- Python (for some features)

## Contributing

1. Fork the repository.
2. Create a new branch (`git checkout -b feature/your-feature`).
3. Commit your changes.
4. Push to your branch.
5. Open a Pull Request.

## License
TODO
<!-- This project is licensed under the MIT License. -->

## Support

For issues and feature requests, please use the [GitHub Issues](https://github.com/ipa-esa/RosTooling_Extension/issues) page.

---
Maintained by [ipa-esa](https://github.com/ipa-esa)