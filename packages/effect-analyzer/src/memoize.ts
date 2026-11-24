export const memoize = <A>(compute: (key: string) => A): (key: string) => A => {
  const cache = new Map<string, { readonly value: A }>()
  return (key) => {
    const hit = cache.get(key) ?? { value: compute(key) }
    cache.set(key, hit)
    return hit.value
  }
}
