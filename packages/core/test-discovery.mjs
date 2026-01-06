import { Effect } from "effect"
import { Discovery } from "./dist/world/discovery/index.js"
import { DiscoveryNodeLive } from "./dist/world/discovery/node.js"

const program = Effect.gen(function* () {
  const discovery = yield* Discovery
  const servers = yield* discovery.discover()
  console.log("Discovered servers:", servers.length)
  console.log(JSON.stringify(servers, null, 2))
})

Effect.runPromise(program.pipe(Effect.provide(DiscoveryNodeLive)))
  .catch(err => {
    console.error("Error:", err)
    process.exit(1)
  })
