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
  label: string;
  createdAt: number;
  expression: string;
  total: number;
  terms: DiceTerm[];
}

export const DICE_HISTORY_LIMIT = 50;
