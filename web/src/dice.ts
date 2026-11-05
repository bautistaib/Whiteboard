export type DiceTerm = {
  kind: "dice";
  notation: string;
  sign: number;
  sides: number;
  rolls: number[];
  kept: boolean[];
  subtotal: number;
} | {
  kind: "constant";
  notation: string;
  sign: number;
  value: number;
  subtotal: number;
};

export interface DiceRoll {
  id: string;
  opId: string;
  clientId: string;
  author: string;
  color?: string;
  label: string;
  createdAt: number;
  expression: string;
  total: number;
  terms: DiceTerm[];
}

export const DICE_HISTORY_LIMIT = 50;

/** Compatibilidad con resultados anteriores que todavía no incluían color. */
export function diceColor(roll: DiceRoll): string {
  return /^#[0-9a-f]{6}$/i.test(roll.color ?? "") ? roll.color! : "#8dc5ff";
}
