function pipeline(x: number) {
  return x + 1;
}

export const notEffect = pipeline(1);
