import { XGov } from "../types";

export function xGovToTuple(xGov: XGov): [number, string, number] {
  return [
    xGov.accountId,
    xGov.account.toString(),
    xGov.votes,
  ];
}
