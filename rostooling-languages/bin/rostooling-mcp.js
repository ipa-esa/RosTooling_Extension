#!/usr/bin/env node
'use strict';

const path = require('path');
const pkg = require(path.join(__dirname, '..', 'package.json'));

const HELP_TEXT = `Usage: rostooling-mcp [options]

Headless Model Context Protocol (MCP) server for Fraunhofer IPA RosTooling
(.ros, .ros2, and .rossystem validation, semantic system editing, code generation,\nand ROS 2 builds).
Communicates over stdio using JSON-RPC 2.0.

Options:
  --jar <path>, --jar=<path>  Explicit path to the RosTooling Language Server fat JAR
  -v, --version               Print server version and exit
  -h, --help                  Show this help message and exit

Environment Variables:
  ROSMODEL_JAR                Path to rostooling_extension-*.jar (overrides auto-discovery)
  ROSMODEL_JAVA               Path to Java 21+ executable (defaults to JAVA_HOME/bin/java or java)
  ROSMODEL_CATALOGUE_DIR      Path to catalogue repositories (defaults to ~/.rostooling/catalogue_repos)

Exposed MCP Tools:
  validate_ros_model          Validate .ros, .ros2, or .rossystem syntax, types, and connections
  generate_ros2_wrappers      Generate C++, Python, or Hybrid ROS 2 node wrappers into src-gen/
  generate_rossystem_code     Generate ROS 2 launch, parameter YAML, and composition packages into src-gen/
  build_ros2_package          Build generated packages with colcon build
  ros_add_spec                Add a msg/srv/action spec + typed fields to a .ros file (creates if missing)
  ros2_add_artifact           Add an artifact/node contract to a .ros2 file (creates if missing)
  ros2_add_interface          Add a pub/sub/ss/sc/as/ac interface (+ QoS/lifecycle) to a .ros2 node
  ros2_add_parameter          Add a parameter declaration to a .ros2 node
  ros2_set_qos                Set or clear QoS policy fields on a .ros2 interface
  ros2_set_property           Set a semantic property on a .ros/.ros2 package, node, interface, or parameter
  ros2_remove_element         Remove an artifact, interface, parameter, spec, or field from .ros/.ros2
  ros_add_node                Add a node instance ("<package>.<node>") to a .rossystem (creates the file)
  ros_add_subsystem           Add a subSystems: reference to a .rossystem composition
  ros_set_system_property     Set top-level name or fromFile on a .rossystem
  ros_connect_interfaces      Connect "<node>.<interface>" -> "<node>.<interface>"
  ros_set_parameter           Set a declared parameter's value on a node instance
  ros_add_process             Group node instances into a process (composable container)
  ros_remove_element          Remove a node, process, subsystem or connection
  export_system_diagram       Write the auto-laid-out system diagram as SVG + structural summary

  The ros_*, ros2_*, and export tools are coordinate-free: they dispatch GLSP operations
  to the Java/Xtext server, which applies them to the Ecore model and edits the file surgically.
`;

const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--help' || arg === '-h') {
    process.stdout.write(HELP_TEXT);
    process.exit(0);
  }
  if (arg === '--version' || arg === '-v') {
    process.stdout.write(`${pkg.version}\n`);
    process.exit(0);
  }
  if (arg === '--jar' && i + 1 < args.length) {
    process.env.ROSMODEL_JAR = path.resolve(args[i + 1]);
    i++;
  } else if (arg.startsWith('--jar=')) {
    process.env.ROSMODEL_JAR = path.resolve(arg.slice('--jar='.length));
  }
}

const { runServer } = require(path.join(__dirname, '..', 'out', 'mcp', 'server.js'));

runServer().catch((err) => {
  console.error('[RosTooling MCP Server Fatal Error]:', err);
  process.exit(1);
});
