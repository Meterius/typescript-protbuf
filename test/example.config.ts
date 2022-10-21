import {Config} from "../src/config";

const config: Config = {
  sourceFile: "test/example.ts",
  outputBasename: "test/example",
  unionInterfaceNameGetter: {
    PlanetOrStar: (data) => `${data}.size !== undefined ? 'Star' : 'Planet'`,
  },
  numberEncoding: {
    default: "float",
    overrides: {
      "Planet.habitable3": "float",
    },
  }
}

export default config;
