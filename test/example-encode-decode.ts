import {clone, isEqual} from "lodash";
import {Star, StatusString} from "./example";
// @ts-ignore
import * as lib from "./example.proto.lib";

function main() {
  const instanceData: Star = {
    size: 5,
    __lassification5: "Constant",
    classification: "heyaaaaaaaaaaaaaaaaaaaaaaaaa",
    c__lassification3: "Constant",
    __lassification4: "Constant",
    status: 0,
    statusStr: StatusString.Paused,
    size2: {
      population: 100,
      notGood: null,
      test: [null, null],
      habitable4: [{
        __lassification4: "Constant",
        __lassification5: "Constant",
        size: 2,children:[],status:1,
      }],
      habitable3: [4],
      habitable: undefined,
      habitable2: {
        __lassification5: "Constant",
        __lassification4: "Constant",
        size:5,status:0,children:[],classification:"Noasdasddsadsasaddsa"},
    },
    children: [],
  };

  const addChild = () => {
    instanceData.children?.push({
      classification: "heyaaaaaaaaaaaaaaaaaaaaaaaaa",
      __lassification4: "Constant",
      __lassification5: "Constant",
      size: {
        classification: "heyaaaaaaaaaaaaaaaaaaaaaaaaa",
        __lassification4: "Constant",
        __lassification5: "Constant",
        size2: {
          test: [],
          population: 100,
          habitable4: [],
          habitable3: [2],
          habitable: undefined,
          habitable2: undefined,
        },
        size: 4,
        statusStr: StatusString.Running,
        status: 1,
        children: [],
      },
      size2: {
        test: [],
        population: 100,
        habitable4: [],
        habitable3: [5],
        habitable: undefined,
        habitable2: undefined,
      },
      status: 0,
      statusStr: StatusString.Running,
      children: [],
    });
  };

  const print = false;

  for (let i = 0; i < (print ? 0 : 200000); i++) {
    addChild();
  }

  if (print) {
    console.log(JSON.stringify(instanceData, undefined, " "));
  }

  let instanceDataClone = clone(instanceData);
  let instanceDataClone2 = clone(instanceData);

  const timeit = (name: string, func: () => void) => {
    const start = Date.now();
    func();
    const end = Date.now();
    console.log(`${name} took ${((end-start)/1000).toFixed(2)} seconds`);
  }

  let translatedData: any;
  timeit("TranslateToData", () => {
    translatedData = lib.Star.translateTo(instanceDataClone);
  });

  timeit("TranslateFromData", () => {
    lib.Star.translateFrom(translatedData);
  });

  let protoEncoding: any;
  timeit("Encoding", () => {
    protoEncoding = lib.Star.encode(instanceDataClone2);
  });

  let protoDecoded: any;
  timeit("Decoding", () => {
    protoDecoded = lib.Star.decode(protoEncoding);
  });

  if (print) {
    console.log(JSON.stringify(protoDecoded, undefined, " "));
    console.log("Equals", isEqual(protoDecoded, instanceData));
  }

  let encodedJson: any;
  timeit("JSON Encoding", () => {
    encodedJson = JSON.stringify(instanceData);
  });

  timeit("JSON Decoding", () => {
    JSON.parse(encodedJson);
  });

  console.log(`Proto Encoding has size ${protoEncoding.byteLength} bytes`);
  console.log(`JSON Encoding has size ${Buffer.from(encodedJson).byteLength} bytes`);
}

main();
