type Tagged = { readonly _tag: string }

export type MemberWithTag<U extends Tagged, Tag extends U["_tag"]> = Extract<U, { readonly _tag: Tag }>

type HandlersByTag<U extends Tagged, Out> = {
  readonly [Tag in keyof Out]: (value: MemberWithTag<U, Tag & U["_tag"]>) => Out[Tag]
}

export const matchTag =
  <U extends Tagged>() =>
  <Out extends { readonly [Tag in U["_tag"]]: unknown }>(
    handlers: HandlersByTag<U, Out> & { readonly [Tag in Exclude<keyof Out, U["_tag"]>]: never },
  ) => {
    const handlerByTag: HandlersByTag<U, Out> = handlers
    return <Tag extends U["_tag"]>(value: MemberWithTag<U, Tag>): Out[Tag] => handlerByTag[value._tag](value)
  }
