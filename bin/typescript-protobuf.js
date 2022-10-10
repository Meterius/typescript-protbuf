#!/usr/bin/env node

require("ts-node").register();
require("../src/cli").main().catch((err) => {
  console.error(err);
  process.exit(1);
});
