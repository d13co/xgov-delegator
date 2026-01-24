import { Member } from "../types";

export function memberToTuple(member: Member): [number, string, number] {
  return [
    member.accountId,
    member.account.toString(),
    member.votes,
  ];
}
