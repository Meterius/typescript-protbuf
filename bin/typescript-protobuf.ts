#!/usr/bin/env ts-node

import { main } from "../src/cli";

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
