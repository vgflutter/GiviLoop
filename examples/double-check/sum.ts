// Deliberately buggy review fixture. Contract: sum([]) must return 0.
export function sum(values: number[]): number {
  return values.reduce((total, value) => total + value);
}
