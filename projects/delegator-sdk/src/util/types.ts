import { AccountWithAlgoHours, AccountWithOffsetHint } from "../types";

export function accountWithAlgoHoursToTuple(accountWithAlgoHours: AccountWithAlgoHours): [string, bigint] {
  return [accountWithAlgoHours.account.toString(), accountWithAlgoHours.algoHours];
}

export function accountWithOffsetHintToTuple(accountWithOffsetHint: AccountWithOffsetHint): [string, number] {
  return [accountWithOffsetHint.account.toString(), accountWithOffsetHint.oracleSuperboxOffset];
}
