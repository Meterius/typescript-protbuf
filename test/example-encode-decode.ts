import {Star, StatusString} from "./example";
import {load} from "./example.proto.lib";

async function main() {
  const root = load();

  const instanceData: Star = {
    size: 5,
    status: 0,
    statusStr: StatusString.Paused,
    size2: {
      population: 100,
      habitable4: [{
        size: 2,children:[],status:1,
      }],
      habitable3: [4],
      habitable: undefined,
      habitable2: {size:5,status:0,children:[]},
    },
    children: [],
  };

  const addChild = () => {
    instanceData.children?.push({
      size: {
        size2: {
          population: 100,
          habitable4: [],
          habitable3: [2],
          habitable: undefined,
          habitable2: undefined,
        },
        size: Math.random(),
        statusStr: StatusString.Running,
        status: 1,
        children: [],
      },
      size2: {
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

  for (let i = 0; i < 0; i++) {
    addChild();
  }

  const Star = root.lookupType("Star");

  console.log(JSON.stringify(instanceData, undefined, " "));
  const instance = Star.fromObject(instanceData);
  console.log(JSON.stringify(Star.toObject(instance, { defaults: true }), undefined, " "));

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
