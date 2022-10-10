import {Star, StatusString} from "./example";
import {load} from "./example.proto.lib";

async function main() {
  const root = load();

  const instanceData: Star = {
    size: 5,
    status: 0,
    statusStr: StatusString.Paused,
    size2: {
      habitable4: [],
      habitable3: [false],
      habitable: undefined,
      habitable2: undefined,
    },
    children: [{
      size2: {
        habitable4: [],
        habitable3: [false],
        habitable: undefined,
        habitable2: undefined,
      },
      size: {
        size: 5,
        size2: {
          habitable4: [],
          habitable3: [false],
          habitable: undefined,
          habitable2: undefined,
        },
        statusStr: StatusString.Running,
        status: 1,
        children: [],
      },
      statusStr: StatusString.Running,
      status: 1,
      children: [],
    }],
  };

  const addChild = () => {
    instanceData.children?.push({
      size: {
        size2: {
          habitable4: [],
          habitable3: [false],
          habitable: undefined,
          habitable2: undefined,
        },
        size: Math.random(),
        statusStr: StatusString.Running,
        status: 1,
        children: [],
      },
      size2: {
        habitable4: [],
        habitable3: [false],
        habitable: undefined,
        habitable2: undefined,
      },
      status: 0,
      statusStr: StatusString.Running,
      children: [],
    });
  };

  for (let i = 0; i < 10000; i++) {
    addChild();
  }

  const Star = root.lookupType("Star");

  const instance = Star.fromObject(instanceData);

  const encodingProtoStart = Date.now();
  const protoEncoding = Star.encode(instance).finish();
  const encodingProtoEnd = Date.now();

  const decodingProtoStart = Date.now();
  const protoDecoding = Star.decode(protoEncoding);
  const decodingProtoEnd = Date.now();

  const encodingJsonStart = Date.now();
  const jsonEncoding = JSON.stringify(instanceData);
  const encodingJsonEnd = Date.now();

  const decodingJsonStart = Date.now();
  const jsonDecoding = JSON.parse(jsonEncoding);
  const decodingJsonEnd = Date.now();

  console.log(`Proto Encoding took ${((encodingProtoEnd-encodingProtoStart)/1000).toFixed(2)} seconds`);
  console.log(`Proto Decoding took ${((decodingProtoEnd-decodingProtoStart)/1000).toFixed(2)} seconds`);
  console.log(`Proto Encoding has size ${protoEncoding.byteLength} bytes`);
  console.log();
  console.log(`JSON Encoding took ${((encodingJsonEnd-encodingJsonStart)/1000).toFixed(2)} seconds`);
  console.log(`JSON Decoding took ${((decodingJsonEnd-decodingJsonStart)/1000).toFixed(2)} seconds`);
  console.log(`JSON Encoding has size ${Buffer.from(jsonEncoding).byteLength} bytes`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
})
