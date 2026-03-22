import { Data, Equal, Hash } from "effect"

export class MyPoint extends Data.Class<{ x: number; y: number }> {
  [Equal.symbol](that: unknown) {
    return that instanceof MyPoint && this.x === that.x && this.y === that.y
  }
  [Hash.symbol]() {
    return Hash.combine(Hash.number(this.x))(Hash.number(this.y))
  }
}
