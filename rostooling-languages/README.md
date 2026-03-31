# rostooling-languages README

This is the repository hosting the VS Code extension for RosTooling language support. This extension provides features such as code completion, validation and syntax highlighting for all four RosTooling DSLs: ROS, ROS1, ROS2, and ROSSYSTEM.

## Features

\!\[ROS2 Package Generation\]\(images/pkg_gen.gif "ROS2 Package Generation" \)

## Requirements

- VS Code (latest version recommended)
- Java 21 or later

## Extension Settings

This extension contributes the following settings:

* `rostooling-languages.server.trace`: Controls the verbosity of the language server trace output. Valid values are: `off`, `messages`, `verbose`.

## Known Issues

> Tested so far on Ubuntu 22.04 with Java 21.

## Release Notes

### 1.1.0

Added ROS 2 package generation feature. Users can now generate ROS 2 packages directly from their ROSSYSTEM files using the Command Palette.

### 1.0.1
Fixed extension versioning to automatically read from the package.json file.

### 1.0.0

Initial release of RosTooling language support extension. Provides code completion, validation, and syntax highlighting for ROS, ROS1, ROS2, and ROSSYSTEM DSLs.
---
