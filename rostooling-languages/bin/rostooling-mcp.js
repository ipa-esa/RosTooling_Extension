#!/usr/bin/env node
'use strict';

const path = require('path');

// Allow explicit CLI override of RosTooling Language Server JAR
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--jar' && i + 1 < args.length) {
    process.env.ROSMODEL_JAR = path.resolve(args[i + 1]);
    i++;
  } else if (args[i].startsWith('--jar=')) {
    process.env.ROSMODEL_JAR = path.resolve(args[i].slice('--jar='.length));
  }
}

const { runServer } = require(path.join(__dirname, '..', 'out', 'mcp', 'server.js'));

runServer().catch((err) => {
  console.error('[RosTooling MCP Server Fatal Error]:', err);
  process.exit(1);
});
