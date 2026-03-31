# RosTooling_Extension

## Overview

RosTooling_Extension is a Visual Studio Code extension designed to enhance development experience for [RosTooling](https://github.com/ipa320/RosTooling.git) languages. It provides the similar content assist functionalities available in Eclipse.

## Features

- Code completion for ROS files
- Syntax highlighting
- Model validation
- ROS 2 package generation [TODO]
- ROS 2 node generation [TODO]

## Installation

1. Clone this RosTooling [repository](https://github.com/ipa-esa/RosTooling.git)
```bash
git clone -b esa/main git@github.com:ipa-esa/RosTooling.git 
```
2. Open the repo and build fatjar server + client
```bash
./gradlew clean installExtension
```

## Testing the extension
1. Run the following command to install the extension and open the demo folder in vs code.
```bash
./gradlew startCode
```
2. Edit the `turtlesim_system.rossystem` file. Use `Ctrl+Space` to trigger content assist and explore the available options.


## Debugging the extension
1. Open the rostooling-languages folder in Visual Studio Code.
2. Set breakpoints in the extension code.
3. Press `F5` to start the extension in debug mode. This will open a new VS Code window with the extension loaded.

## Requirements

- Visual Studio Code (latest version recommended)
- Ubuntu 22.04 or later
- ROS (Humble or later)

**Note**: Windows support is buggy and is being fixed.

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