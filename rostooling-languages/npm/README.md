# RosTooling MCP server

Headless [Model Context Protocol](https://modelcontextprotocol.io) server for the Fraunhofer IPA
[RosTooling](https://github.com/ipa-esa/RosTooling) model languages (`.ros`, `.ros2`, `.rossystem`).
It lets an agent validate models, author them semantically and generate ROS 2 code, without the
VS Code extension.

All model work runs in the bundled Java language/GLSP server (Xtext + Ecore): the tools dispatch
semantic operations, and the server applies them to the model and edits the file surgically
(comments and formatting are kept). No coordinates or layout files are involved.

## Requirements

- Node.js 20 or newer
- Java 21 or newer (`java` on the `PATH`, `JAVA_HOME`, or `ROSMODEL_JAVA`)

## Use

```bash
npx -y @rostooling/rostooling-mcp --help
```

MCP client configuration (stdio):

```json
{
  "mcpServers": {
    "rostooling": {
      "command": "npx",
      "args": ["-y", "@rostooling/rostooling-mcp"]
    }
  }
}
```

## Tools

- Validation and generation: `validate_ros_model`, `generate_ros2_wrappers`, `list_ros2_distros`,
  `generate_rossystem_code`, `build_ros2_package`.
- `.ros` / `.ros2` authoring: `ros_add_spec`, `ros2_add_artifact`, `ros2_add_interface`,
  `ros2_add_parameter`, `ros2_set_qos`, `ros2_set_property`, `ros2_remove_element`.
- `.rossystem` authoring: `ros_add_node`, `ros_add_subsystem`, `ros_set_system_property`,
  `ros_connect_interfaces`, `ros_auto_connect` (dry run, then apply chosen candidates),
  `ros_set_parameter`, `ros_add_process`, `ros_remove_element`, `export_system_diagram`.

`rostooling-mcp --help` lists them with a short description each.

## Configuration

| Variable | Meaning |
|---|---|
| `ROSMODEL_JAR` | Use another `rostooling_extension-*.jar` instead of the bundled one |
| `ROSMODEL_JAVA` | Java 21+ executable |
| `ROSMODEL_CATALOGUE_DIR` | Model catalogue folder (default `~/.rostooling/catalogue_repos`) |

## License

Apache-2.0
