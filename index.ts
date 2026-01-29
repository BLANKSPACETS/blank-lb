import { Effect } from "effect";


const somePromise = Effect.promise(() => Promise.resolve("Hello"));


Effect.runPromise(somePromise).then(console.log);