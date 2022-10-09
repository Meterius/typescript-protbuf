import {Star, Status, StatusString} from "./example";
import {load} from "./example.proto.setup";

async function main() {
  const root = load();

  const instanceData: Star = {
    size: 5,
    status: 0,
    statusStr: StatusString.Paused,
    child: {
      size: false,
      statusStr: StatusString.Running,
      status: 1,
    },
  };

  const Star = root.lookupType("Star");

  const instance = Star.fromObject(instanceData);
  const buffer = Star.encode(instance).finish();
  const decodedInstance = Star.decode(buffer);

  console.log(
    buffer.length, Star.toObject(decodedInstance)
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
})
