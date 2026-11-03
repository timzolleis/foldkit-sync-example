import { Effect, Schema } from "effect"

export const messageWithDefault = (message: string) =>
  Schema.String.pipe(Schema.withConstructorDefault(Effect.succeed(message)))
