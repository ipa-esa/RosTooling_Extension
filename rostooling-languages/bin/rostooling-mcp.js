#!/usr/bin/env node
'use strict';

const path = require('path');
const pkg = require(path.join(__dirname, '..', 'package.json'));

const HELP_TEXT = `Usage: rostooling-mcp [options]

Headless Model Context Protocol (MCP) server for Fraunhofer IPA RosTooling
(.ros, .ros2, and .rossystem DSL validation, code generation, and ROS 2 builds).
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
